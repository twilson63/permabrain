-module(lustre@runtime@app).
-compile([no_auto_import, nowarn_unused_vars, nowarn_unused_function, nowarn_nomatch, inline]).
-define(FILEPATH, "src/lustre/runtime/app.gleam").
-export([configure_server_component/1, configure/1]).
-export_type([app/3, config/1, option/1]).

-if(?OTP_RELEASE >= 27).
-define(MODULEDOC(Str), -moduledoc(Str)).
-define(DOC(Str), -doc(Str)).
-else.
-define(MODULEDOC(Str), -compile([])).
-define(DOC(Str), -compile([])).
-endif.

?MODULEDOC(false).

-type app(VYR, VYS, VYT) :: {app,
        gleam@option:option(gleam@erlang@process:name(lustre@runtime@server@runtime:message(VYT))),
        fun((VYR) -> {VYS, lustre@effect:effect(VYT)}),
        fun((VYS, VYT) -> {VYS, lustre@effect:effect(VYT)}),
        fun((VYS) -> lustre@vdom@vnode:element(VYT)),
        config(VYT)}.

-type config(VYU) :: {config,
        boolean(),
        boolean(),
        boolean(),
        list({binary(), fun((binary()) -> {ok, VYU} | {error, nil})}),
        list({binary(), gleam@dynamic@decode:decoder(VYU)}),
        list({binary(), gleam@dynamic@decode:decoder(VYU)}),
        boolean(),
        gleam@option:option(fun((binary()) -> VYU)),
        gleam@option:option(VYU),
        gleam@option:option(fun((binary()) -> VYU)),
        gleam@option:option(fun((boolean()) -> VYU)),
        gleam@option:option(VYU),
        gleam@option:option(VYU),
        gleam@option:option(VYU)}.

-type option(VYV) :: {option, fun((config(VYV)) -> config(VYV))}.

-file("src/lustre/runtime/app.gleam", 77).
?DOC(false).
-spec configure_server_component(config(VZA)) -> lustre@runtime@server@runtime:config(VZA).
configure_server_component(Config) ->
    {config,
        erlang:element(2, Config),
        erlang:element(3, Config),
        maps:from_list(lists:reverse(erlang:element(5, Config))),
        maps:from_list(lists:reverse(erlang:element(6, Config))),
        maps:from_list(lists:reverse(erlang:element(7, Config))),
        erlang:element(13, Config),
        erlang:element(15, Config)}.

-file("src/lustre/runtime/app.gleam", 73).
?DOC(false).
-spec configure(list(option(VYW))) -> config(VYW).
configure(Options) ->
    gleam@list:fold(
        Options,
        {config,
            true,
            true,
            false,
            [],
            [],
            [],
            false,
            none,
            none,
            none,
            none,
            none,
            none,
            none},
        fun(Config, Option) -> (erlang:element(2, Option))(Config) end
    ).
