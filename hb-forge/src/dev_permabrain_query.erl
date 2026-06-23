%%% @doc PermaBrain Query Device
%%%
%%% Provides structured PermaBrain query capabilities on HyperBEAM,
%%% wrapping the ~query@1.0 and ~match@1.0 devices for article and
%%% attestation lookups.
%%%
%%% Functions:
%%%   query/2         — Search articles by key, kind, topic
%%%   attestations/2  — Find attestations for a target article
%%%   resolve/2       — Resolve a PermaBrain reference to latest version
%%%   info/1          — Return device metadata
%%%
%%% @see https://github.com/twilson63/permabrain

-module(dev_permabrain_query).

-export([query/2, attestations/2, resolve/2, info/1, build_query_path/3]).

%% @doc Search PermaBrain articles by key, kind, or topic.
%% Uses the ~query@1.0 device with PermaBrain-specific tag filters.
-spec query(hb_message:message(), hb_message:message()) -> hb_message:message().
query(Base, _Opts) ->
    ArticleKey = hb_message:get(<<"Article-Key">>, Base, undefined),
    Kind = hb_message:get(<<"Article-Kind">>, Base, undefined),
    Topic = hb_message:get(<<"Article-Topic">>, Base, undefined),
    
    QueryPath = build_query_path(ArticleKey, Kind, Topic),
    case hb_cache:get(QueryPath, Base, #{}) of
        {error, _} ->
            hb_message:set(#{status => error, body => <<"Query failed">>}, Base);
        Results when is_list(Results) ->
            hb_message:set(#{
                status => ok,
                results => Results,
                count => length(Results)
            }, Base);
        Other ->
            hb_message:set(#{
                status => ok,
                results => Other,
                count => 0
            }, Base)
    end.

%% @doc Find attestations targeting a specific article.
-spec attestations(hb_message:message(), hb_message:message()) -> hb_message:message().
attestations(Base, _Opts) ->
    Target = hb_message:get(<<"Attestation-Target">>, Base, undefined),
    case Target of
        undefined ->
            hb_message:set(#{status => error, body => <<"Missing Attestation-Target">>}, Base);
        _ ->
            MatchPath = <<"~match@1.0/Attestation-Target=", Target/binary>>,
            case hb_cache:get(MatchPath, Base, #{}) of
                {error, _} ->
                    hb_message:set(#{status => ok, target => Target, attestations => [], count => 0}, Base);
                Results when is_list(Results) ->
                    hb_message:set(#{
                        status => ok,
                        target => Target,
                        attestations => Results,
                        count => length(Results)
                    }, Base);
                Other ->
                    hb_message:set(#{status => ok, target => Target, attestations => Other, count => 0}, Base)
            end
    end.

%% @doc Resolve a PermaBrain reference to its latest version.
%% Uses ~reference@1.0 to follow the reference chain.
-spec resolve(hb_message:message(), hb_message:message()) -> hb_message:message().
resolve(Base, _Opts) ->
    RefId = hb_message:get(<<"reference-id">>, Base, undefined),
    Path = hb_message:get(<<"path">>, Base, undefined),
    case RefId of
        undefined ->
            hb_message:set(#{status => error, body => <<"Missing reference-id">>}, Base);
        _ ->
            RefPath = case Path of
                undefined -> <<"~reference@1.0">>;
                P -> <<"~reference@1.0/", P/binary>>
            end,
            ResolvePath = <<RefId/binary, RefPath/binary>>,
            case hb_cache:get(ResolvePath, Base, #{}) of
                {error, _} ->
                    hb_message:set(#{status => error, body => <<"Reference resolution failed">>}, Base);
                Result ->
                    hb_message:set(#{status => ok, reference => RefId, resolved => Result}, Base)
            end
    end.

%% @doc Return device metadata.
-spec info(hb_message:message()) -> hb_message:message().
info(_Msg) ->
    #{
        status => ok,
        device => <<"permabrain-query">>,
        version => <<"1.0.0">>,
        functions => [<<"query">>, <<"attestations">>, <<"resolve">>, <<"info">>]
    }.

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