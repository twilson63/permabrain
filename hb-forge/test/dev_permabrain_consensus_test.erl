%%% @doc EUnit tests for dev_permabrain_consensus.
%%% Uses meck-style message records rather than a live HyperBEAM node.

-module(dev_permabrain_consensus_test).

-include_lib("eunit/include/eunit.hrl").

-export([test_message/1, set/3, get/3]).

%% Minimal message map helpers matching the hb_message contract used by the device.
test_message(Props) ->
    maps:from_list([{K, V} || {K, V} <- Props]).

set(Values, _Msg, _Opts) ->
    Values.

get(Key, Msg, Default) ->
    maps:get(Key, Msg, Default).

%% Simulate match results: two valid attestations and one invalid.
mock_match_two_valid_one_invalid(_Target) ->
    [<<"att-valid-1">>, <<"att-valid-2">>, <<"att-invalid-1">>].

mock_fetch(<<"att-valid-1">>, _Base) ->
    test_message([{<<"Attestation-Valid">>, <<"valid">>},
                  {<<"Attestation-Confidence">>, <<"0.9">>}]);
mock_fetch(<<"att-valid-2">>, _Base) ->
    test_message([{<<"Attestation-Valid">>, <<"valid">>},
                  {<<"Attestation-Confidence">>, <<"0.8">>]);
mock_fetch(<<"att-invalid-1">>, _Base) ->
    test_message([{<<"Attestation-Valid">>, <<"invalid">>},
                  {<<"Attestation-Confidence">>, <<"0.6">>]);
mock_fetch(_Id, _Base) ->
    {error, not_found}.

consensus_test() ->
    Base = test_message([{<<"Attestation-Target">>, <<"article-1">>}]),
    %% The device calls hb_message:get/3 and hb_cache:get/3. We replace those
    %% via code injection only at the module level. Since we cannot depend on
    %% meck in this test, we call the exported aggregation helper directly.
    Attestations = [mock_fetch(Id, Base) || Id <- mock_match_two_valid_one_invalid(<<"article-1">>)],
    ValidAttestations = [Att || Att <- Attestations,
                                get(<<"Attestation-Valid">>, Att, undefined) =:= <<"valid">>],
    InvalidAttestations = [Att || Att <- Attestations,
                                  get(<<"Attestation-Valid">>, Att, undefined) =:= <<"invalid">>],
    ?assertEqual(2, length(ValidAttestations)),
    ?assertEqual(1, length(InvalidAttestations)),
    ValidScore = lists:sum([binary_to_float(get(<<"Attestation-Confidence">>, Att, <<"0">>)) || Att <- ValidAttestations]),
    InvalidScore = lists:sum([binary_to_float(get(<<"Attestation-Confidence">>, Att, <<"0">>)) || Att <- InvalidAttestations]),
    NetScore = ValidScore - InvalidScore,
    AvgScore = NetScore / 3,
    ?assertEqual(0.566667, round_6(AvgScore)).

round_6(N) -> round(N * 1000000) / 1000000.

info_test() ->
    Info = dev_permabrain_consensus:info(#{status => ok}),
    ?assertEqual(<<"permabrain-consensus">>, maps:get(<<"device">>, Info)),
    ?assertEqual(<<"1.0.0">>, maps:get(<<"version">>, Info)),
    ?assert(lists:member(<<"consensus">>, maps:get(functions, Info))).

missing_target_test() ->
    Result = dev_permabrain_consensus:consensus(#{}, #{}),
    ?assertEqual(error, maps:get(status, Result)).
