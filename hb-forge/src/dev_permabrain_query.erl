%%% @doc PermaBrain Query Device
%%%
%%% Provides structured PermaBrain query capabilities on HyperBEAM,
%%% wrapping the ~query@1.0 and ~match@1.0 devices for article and
%%% attestation lookups. Mirrors the PERMABRAIN_QUERY_LUA contract.
%%%
%%% Functions (AO-Core device convention: Fun(Base, Req, Opts)):
%%%   query/3         — Search articles by key, kind, topic
%%%   attestations/3  — Find attestations for a target article
%%%   resolve/3       — Resolve a PermaBrain reference to latest version
%%%   info/1          — Return device metadata
%%%
%%% @see https://github.com/twilson63/permabrain
-module(dev_permabrain_query).

-export([query/3, attestations/3, resolve/3, info/1]).

%% @doc Search PermaBrain articles by key, kind, or topic.
%% Uses the ~query@1.0 device with PermaBrain-specific tag filters.
query(Base, Req, Opts) ->
    ArticleKey = field(<<"article-key">>, Base, Req, Opts),
    Kind = field(<<"article-kind">>, Base, Req, Opts),
    Topic = field(<<"article-topic">>, Base, Req, Opts),
    QueryPath = build_query_path(ArticleKey, Kind, Topic),
    case safe_resolve(QueryPath, Opts) of
        {ok, Results} when is_list(Results) ->
            {ok, #{
                <<"status">> => <<"ok">>,
                <<"results">> => Results,
                <<"count">> => length(Results)
            }};
        {ok, Other} ->
            {ok, #{
                <<"status">> => <<"ok">>,
                <<"results">> => Other,
                <<"count">> => 0
            }};
        _ ->
            {ok, #{
                <<"status">> => <<"ok">>,
                <<"results">> => [],
                <<"count">> => 0
            }}
    end.

%% @doc Find attestations targeting a specific article.
attestations(Base, Req, Opts) ->
    Target = field(<<"attestation-target">>, Base, Req, Opts),
    case Target of
        undefined ->
            {ok, #{
                <<"status">> => <<"error">>,
                <<"body">> => <<"Missing Attestation-Target">>
            }};
        _ ->
            Results = match_target(Target, Opts),
            {ok, #{
                <<"status">> => <<"ok">>,
                <<"target">> => Target,
                <<"attestations">> => Results,
                <<"count">> => length(Results)
            }}
    end.

%% @doc Find message paths whose `Attestation-Target' equals the target, via the
%% cache match index. Defensive: ~match@1.0 raises when a key is absent.
match_target(Target, Opts) ->
    try hb_cache:match(#{<<"attestation-target">> => Target}, Opts) of
        {ok, Matches} when is_list(Matches) -> Matches;
        _ -> []
    catch
        _:_ -> []
    end.

%% @doc Resolve a PermaBrain reference to its latest version.
%% Uses ~reference@1.0 to follow the reference chain.
resolve(Base, Req, Opts) ->
    RefId = field(<<"reference-id">>, Base, Req, Opts),
    Path = field(<<"path">>, Base, Req, Opts),
    case RefId of
        undefined ->
            {ok, #{
                <<"status">> => <<"error">>,
                <<"body">> => <<"Missing reference-id">>
            }};
        _ ->
            RefPath =
                case Path of
                    undefined -> <<"~reference@1.0">>;
                    P -> <<"~reference@1.0/", P/binary>>
                end,
            ResolvePath = <<RefId/binary, RefPath/binary>>,
            case safe_resolve(ResolvePath, Opts) of
                {ok, Result} ->
                    {ok, #{
                        <<"status">> => <<"ok">>,
                        <<"reference">> => RefId,
                        <<"resolved">> => Result
                    }};
                _ ->
                    {ok, #{
                        <<"status">> => <<"error">>,
                        <<"body">> => <<"Reference resolution failed">>
                    }}
            end
    end.

%% @doc Return device metadata.
info(_Msg) ->
    #{
        <<"status">> => <<"ok">>,
        <<"device">> => <<"permabrain-query">>,
        <<"version">> => <<"1.0.0">>,
        <<"functions">> => [<<"query">>, <<"attestations">>, <<"resolve">>, <<"info">>]
    }.

%% @doc Resolve an AO-Core path defensively; never let an upstream device
%% exception crash the calling request.
safe_resolve(Path, Opts) ->
    try hb_ao:resolve(Path, Opts) of
        Result -> Result
    catch
        _:_ -> {error, resolve_failed}
    end.

%% @doc Read a field from the request, then the base message, case-insensitively.
field(Key, Base, Req, Opts) ->
    case hb_ao:get(Key, Req, undefined, Opts) of
        undefined -> hb_ao:get(Key, Base, undefined, Opts);
        Value -> Value
    end.

%% Internal: Build ~query@1.0 URL with PermaBrain filters
build_query_path(ArticleKey, Kind, Topic) ->
    Base = <<"~query@1.0?App-Name=PermaBrain">>,
    WithKey = case ArticleKey of
        undefined -> Base;
        K -> <<Base/binary, "&Article-Key=", K/binary>>
    end,
    WithKind = case Kind of
        undefined -> WithKey;
        Kd -> <<WithKey/binary, "&Article-Kind=", Kd/binary>>
    end,
    case Topic of
        undefined -> WithKind;
        T -> <<WithKind/binary, "&Article-Topic=", T/binary>>
    end.

%%%-------------------------------------------------------------------
%%% Tests
%%%-------------------------------------------------------------------
-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

build_query_path_base_test() ->
    ?assertEqual(<<"~query@1.0?App-Name=PermaBrain">>,
        build_query_path(undefined, undefined, undefined)).

build_query_path_key_test() ->
    ?assertEqual(<<"~query@1.0?App-Name=PermaBrain&Article-Key=subject/test">>,
        build_query_path(<<"subject/test">>, undefined, undefined)).

build_query_path_kind_only_test() ->
    ?assertEqual(<<"~query@1.0?App-Name=PermaBrain&Article-Kind=note">>,
        build_query_path(undefined, <<"note">>, undefined)).

build_query_path_all_test() ->
    ?assertEqual(
        <<"~query@1.0?App-Name=PermaBrain&Article-Key=k&Article-Kind=kd&Article-Topic=t">>,
        build_query_path(<<"k">>, <<"kd">>, <<"t">>)).

info_test() ->
    Info = info(#{}),
    ?assertEqual(<<"ok">>, maps:get(<<"status">>, Info)),
    ?assertEqual(<<"permabrain-query">>, maps:get(<<"device">>, Info)),
    ?assertEqual(<<"1.0.0">>, maps:get(<<"version">>, Info)).

-endif.
