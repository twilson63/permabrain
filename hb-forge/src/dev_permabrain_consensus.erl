%%% @doc PermaBrain Consensus Device
%%%
%%% Computes weighted consensus scores for articles by resolving
%%% attestations via the match device and aggregating validity/confidence.
%%%
%%% This is the Erlang implementation of the PermaBrain consensus Lua script
%%% (PERMABRAIN_CONSENSUS_LUA), packaged as a proper HyperBEAM Forge device.
%%% It mirrors that script's contract exactly: attestations are matched by the
%%% `Attestation-Target' tag and scored from `Attestation-Valid' (valid|invalid)
%%% weighted by `Attestation-Confidence'.
%%%
%%% Functions (AO-Core device convention: Fun(Base, Req, Opts)):
%%%   consensus/3 — Compute consensus for an article (Attestation-Target field)
%%%   info/1      — Return device metadata
%%%
%%% Usage from HyperBEAM:
%%%   GET /~permabrain-consensus@1.0/consensus
%%%   Header: Attestation-Target: {ArticleId}
%%%
%%% @see https://github.com/twilson63/permabrain
-module(dev_permabrain_consensus).

-export([consensus/3, info/1]).

%% @doc Compute consensus score for an article.
%% Reads `Attestation-Target' from the request, resolves all matching
%% attestations via ~match@1.0, then aggregates valid/invalid scores
%% weighted by confidence. Returns `{ok, ResultMessage}'.
consensus(Base, Req, Opts) ->
    Target = field(<<"attestation-target">>, Base, Req, Opts),
    case Target of
        undefined ->
            {ok, #{
                <<"status">> => <<"error">>,
                <<"body">> => <<"Missing Attestation-Target">>
            }};
        _ ->
            case match_attestations(Target, Opts) of
                [] ->
                    %% No match index entry, empty result, or resolution error:
                    %% report zero attestations, matching the Lua contract.
                    {ok, #{
                        <<"status">> => <<"ok">>,
                        <<"Consensus-Score">> => <<"0">>,
                        <<"Consensus-Count">> => <<"0">>,
                        <<"Consensus-Status">> => <<"no-attestations">>
                    }};
                AttIds ->
                    {ValidScore, InvalidScore, ValidCount, InvalidCount} =
                        aggregate_attestations(AttIds, Opts, 0, 0, 0, 0),
                    TotalCount = ValidCount + InvalidCount,
                    NetScore = ValidScore - InvalidScore,
                    AvgScore =
                        if TotalCount > 0 -> NetScore / TotalCount; true -> 0.0 end,
                    Status =
                        if TotalCount > 0 -> <<"computed">>;
                           true -> <<"no-attestations">>
                        end,
                    {ok, #{
                        <<"status">> => <<"ok">>,
                        <<"Consensus-Score">> => float_to_binary(AvgScore, [{decimals, 6}]),
                        <<"Consensus-Count">> => integer_to_binary(TotalCount),
                        <<"Consensus-Valid-Count">> => integer_to_binary(ValidCount),
                        <<"Consensus-Invalid-Count">> => integer_to_binary(InvalidCount),
                        <<"Consensus-Status">> => Status
                    }}
            end
    end.

%% @doc Find attestation message paths for a target via the cache match index.
%% Wrapped defensively: the underlying ~match@1.0 device raises (rather than
%% returning an error tuple) when a key is absent from the index, so we treat
%% any failure as "no attestations" rather than crashing the request.
match_attestations(Target, Opts) ->
    try hb_cache:match(#{<<"attestation-target">> => Target}, Opts) of
        {ok, Matches} when is_list(Matches) -> Matches;
        _ -> []
    catch
        _:_ -> []
    end.

%% @doc Aggregate attestation scores by reading each attestation message.
aggregate_attestations([], _Opts, VS, IS, VC, IC) -> {VS, IS, VC, IC};
aggregate_attestations([Id | Rest], Opts, VS, IS, VC, IC) ->
    case read_message(Id, Opts) of
        {ok, Att} when is_map(Att) ->
            Valid = hb_ao:get(<<"attestation-valid">>, Att, undefined, Opts),
            Confidence =
                parse_confidence(hb_ao:get(<<"attestation-confidence">>, Att, <<"0">>, Opts)),
            case Valid of
                <<"valid">> ->
                    aggregate_attestations(Rest, Opts, VS + Confidence, IS, VC + 1, IC);
                <<"invalid">> ->
                    aggregate_attestations(Rest, Opts, VS, IS + Confidence, VC, IC + 1);
                _ ->
                    aggregate_attestations(Rest, Opts, VS, IS, VC, IC)
            end;
        _ ->
            aggregate_attestations(Rest, Opts, VS, IS, VC, IC)
    end.

%% @doc Read a message from the cache by ID/path, defensively.
read_message(Id, Opts) ->
    try hb_cache:read(Id, Opts) of
        {ok, Msg} -> {ok, Msg};
        Other -> Other
    catch
        _:_ -> {error, read_failed}
    end.

%% @doc Read a field from the request, then the base message, case-insensitively.
field(Key, Base, Req, Opts) ->
    case hb_ao:get(Key, Req, undefined, Opts) of
        undefined -> hb_ao:get(Key, Base, undefined, Opts);
        Value -> Value
    end.

parse_confidence(Value) when is_float(Value) -> Value;
parse_confidence(Value) when is_integer(Value) -> Value * 1.0;
parse_confidence(Value) when is_binary(Value) ->
    try binary_to_float(Value)
    catch
        error:badarg ->
            try binary_to_integer(Value) * 1.0
            catch error:badarg -> 0.0 end
    end;
parse_confidence(_) -> 0.0.

%% @doc Return device metadata.
info(_Msg) ->
    #{
        <<"status">> => <<"ok">>,
        <<"device">> => <<"permabrain-consensus">>,
        <<"version">> => <<"1.0.0">>,
        <<"functions">> => [<<"consensus">>, <<"info">>]
    }.

%%%-------------------------------------------------------------------
%%% Tests
%%%-------------------------------------------------------------------
-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

parse_confidence_float_test() ->
    ?assertEqual(0.5, parse_confidence(0.5)).

parse_confidence_integer_test() ->
    ?assertEqual(5.0, parse_confidence(5)).

parse_confidence_binary_float_test() ->
    ?assertEqual(0.75, parse_confidence(<<"0.75">>)).

parse_confidence_binary_integer_test() ->
    ?assertEqual(3.0, parse_confidence(<<"3">>)).

parse_confidence_invalid_binary_test() ->
    ?assertEqual(0.0, parse_confidence(<<"not-a-number">>)).

parse_confidence_other_test() ->
    ?assertEqual(0.0, parse_confidence(undefined)).

%% Empty attestation set yields zeroed accumulators without touching the cache.
aggregate_empty_test() ->
    ?assertEqual({0, 0, 0, 0},
        aggregate_attestations([], #{}, 0, 0, 0, 0)).

info_test() ->
    Info = info(#{}),
    ?assertEqual(<<"ok">>, maps:get(<<"status">>, Info)),
    ?assertEqual(<<"permabrain-consensus">>, maps:get(<<"device">>, Info)),
    ?assertEqual(<<"1.0.0">>, maps:get(<<"version">>, Info)).

-endif.
