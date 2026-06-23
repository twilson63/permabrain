%%% @doc PermaBrain Consensus Device
%%%
%%% Computes weighted consensus scores for articles by resolving
%%% attestations via the match device and aggregating validity/confidence.
%%%
%%% This is the Erlang implementation of the PermaBrain consensus Lua script,
%%% packaged as a proper HyperBEAM Forge device.
%%%
%%% Functions:
%%%   consensus/2 — Compute consensus for an article (Attestation-Target header)
%%%   info/1      — Return device metadata
%%%
%%% Usage from HyperBEAM:
%%%   GET /{ProcessId}~process@1.0/consensus
%%%   Header: Attestation-Target: {ArticleId}
%%%
%%% @see https://github.com/twilson63/permabrain

-module(dev_permabrain_consensus).

-export([consensus/2, info/1]).

%% @doc Compute consensus score for an article.
%% Expects 'Attestation-Target' in the base message headers.
%% Resolves all attestations via ~match@1.0, then aggregates
%% valid/invalid scores weighted by confidence.
-spec consensus(hb_message:message(), hb_message:message()) -> hb_message:message().
consensus(Base, _Opts) ->
    Target = hb_message:get(<<"Attestation-Target">>, Base, undefined),
    case Target of
        undefined ->
            hb_message:set(#{status => error, body => <<"Missing Attestation-Target">>}, Base);
        _ ->
            MatchPath = <<"~match@1.0/Attestation-Target=", Target/binary>>,
            case hb_cache:get(MatchPath, Base, #{}) of
                {error, _} ->
                    hb_message:set(#{status => ok, 
                                     <<"Consensus-Score">> => <<"0">>,
                                     <<"Consensus-Count">> => <<"0">>,
                                     <<"Consensus-Status">> => <<"no-attestations">>}, Base);
                AttIds when is_list(AttIds) ->
                    {ValidScore, InvalidScore, ValidCount, InvalidCount} = 
                        aggregate_attestations(AttIds, Base, 0, 0, 0, 0),
                    TotalCount = ValidCount + InvalidCount,
                    NetScore = ValidScore - InvalidScore,
                    AvgScore = if TotalCount > 0 -> NetScore / TotalCount; true -> 0 end,
                    Status = if TotalCount > 0 -> <<"computed">>; true -> <<"no-attestations">> end,
                    hb_message:set(#{
                        status => ok,
                        <<"Consensus-Score">> => float_to_binary(AvgScore, [{decimals, 6}]),
                        <<"Consensus-Count">> => integer_to_binary(TotalCount),
                        <<"Consensus-Valid-Count">> => integer_to_binary(ValidCount),
                        <<"Consensus-Invalid-Count">> => integer_to_binary(InvalidCount),
                        <<"Consensus-Status">> => Status
                    }, Base)
            end
    end.

%% @doc Aggregate attestation scores.
aggregate_attestations([], _Base, VS, IS, VC, IC) -> {VS, IS, VC, IC};
aggregate_attestations([Id | Rest], Base, VS, IS, VC, IC) ->
    case hb_cache:get(Id, Base, #{}) of
        {error, _} -> aggregate_attestations(Rest, Base, VS, IS, VC, IC);
        Att ->
            Valid = hb_message:get(<<"Attestation-Valid">>, Att, undefined),
            Confidence = binary_to_float(hb_message:get(<<"Attestation-Confidence">>, Att, <<"0">>)),
            case Valid of
                <<"valid">> -> aggregate_attestations(Rest, Base, VS + Confidence, IS, VC + 1, IC);
                <<"invalid">> -> aggregate_attestations(Rest, Base, VS, IS + Confidence, VC, IC + 1);
                _ -> aggregate_attestations(Rest, Base, VS, IS, VC, IC)
            end
    end.

%% @doc Return device metadata.
-spec info(hb_message:message()) -> hb_message:message().
info(_Msg) ->
    #{
        status => ok,
        device => <<"permabrain-consensus">>,
        version => <<"1.0.0">>,
        functions => [<<"consensus">>, <<"info">>]
    }.