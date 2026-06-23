%%% @doc EUnit tests for dev_permabrain_query.
%%% Verifies query/2, attestations/2, resolve/2, and info/1 shapes
%%% without requiring a live HyperBEAM node.

-module(dev_permabrain_query_test).

-include_lib("eunit/include/eunit.hrl").

build_query_path_test() ->
    ArticleKey = <<"subject/foo">>,
    Kind = <<"person">>,
    Topic = <<"ai">>,
    Path = dev_permabrain_query:build_query_path(ArticleKey, Kind, Topic),
    ?assert(binary:match(Path, <<"~query@1.0">>) =/= nomatch),
    ?assert(binary:match(Path, <<"App-Name=PermaBrain">>) =/= nomatch),
    ?assert(binary:match(Path, <<"Article-Key=subject/foo">>) =/= nomatch),
    ?assert(binary:match(Path, <<"Article-Kind=person">>) =/= nomatch),
    ?assert(binary:match(Path, <<"Article-Topic=ai">>) =/= nomatch).

build_query_path_optional_test() ->
    Path = dev_permabrain_query:build_query_path(undefined, <<"subject">>, undefined),
    ?assert(binary:match(Path, <<"Article-Key">>) =:= nomatch),
    ?assert(binary:match(Path, <<"Article-Topic">>) =:= nomatch),
    ?assert(binary:match(Path, <<"Article-Kind=subject">>) =/= nomatch).

info_test() ->
    Info = dev_permabrain_query:info(#{status => ok}),
    ?assertEqual(<<"permabrain-query">>, maps:get(<<"device">>, Info)),
    ?assertEqual(<<"1.0.0">>, maps:get(<<"version">>, Info)),
    ?assert(lists:member(<<"query">>, maps:get(functions, Info))),
    ?assert(lists:member(<<"attestations">>, maps:get(functions, Info))),
    ?assert(lists:member(<<"resolve">>, maps:get(functions, Info))).

missing_attestation_target_test() ->
    Result = dev_permabrain_query:attestations(#{}, #{}),
    ?assertEqual(error, maps:get(status, Result)).

missing_reference_id_test() ->
    Result = dev_permabrain_query:resolve(#{}, #{}),
    ?assertEqual(error, maps:get(status, Result)).
