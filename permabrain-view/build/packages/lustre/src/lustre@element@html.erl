-module(lustre@element@html).
-compile([no_auto_import, nowarn_unused_vars, nowarn_unused_function, nowarn_nomatch, inline]).
-define(FILEPATH, "src/lustre/element/html.gleam").
-export([html/2, text/1, base/1, head/2, link/1, meta/1, style/2, title/2, body/2, address/2, article/2, aside/2, footer/2, header/2, h1/2, h2/2, h3/2, h4/2, h5/2, h6/2, hgroup/2, main/2, nav/2, section/2, search/2, blockquote/2, dd/2, 'div'/2, dl/2, dt/2, figcaption/2, figure/2, hr/1, li/2, menu/2, ol/2, p/2, pre/2, ul/2, a/2, abbr/2, b/2, bdi/2, bdo/2, br/1, cite/2, code/2, data/2, dfn/2, em/2, i/2, kbd/2, mark/2, q/2, rp/2, rt/2, ruby/2, s/2, samp/2, small/2, span/2, strong/2, sub/2, sup/2, time/2, u/2, var/2, wbr/1, area/1, audio/2, img/1, map/2, track/1, video/2, embed/1, iframe/1, object/1, picture/2, portal/1, source/1, math/2, svg/2, canvas/1, noscript/2, script/2, del/2, ins/2, caption/2, col/1, colgroup/2, table/2, tbody/2, td/2, tfoot/2, th/2, thead/2, tr/2, button/2, datalist/2, fieldset/2, form/2, input/1, label/2, legend/2, meter/2, optgroup/2, option/2, output/2, progress/2, select/2, textarea/2, details/2, dialog/2, summary/2, slot/2, template/2]).

-if(?OTP_RELEASE >= 27).
-define(MODULEDOC(Str), -moduledoc(Str)).
-define(DOC(Str), -doc(Str)).
-else.
-define(MODULEDOC(Str), -compile([])).
-define(DOC(Str), -compile([])).
-endif.

-file("src/lustre/element/html.gleam", 11).
?DOC("\n").
-spec html(
    list(lustre@vdom@vattr:attribute(RSL)),
    list(lustre@vdom@vnode:element(RSL))
) -> lustre@vdom@vnode:element(RSL).
html(Attrs, Children) ->
    lustre@element:element(<<"html"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 18).
-spec text(binary()) -> lustre@vdom@vnode:element(any()).
text(Content) ->
    lustre@element:text(Content).

-file("src/lustre/element/html.gleam", 25).
?DOC("\n").
-spec base(list(lustre@vdom@vattr:attribute(RST))) -> lustre@vdom@vnode:element(RST).
base(Attrs) ->
    lustre@element:element(<<"base"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 30).
?DOC("\n").
-spec head(
    list(lustre@vdom@vattr:attribute(RSX)),
    list(lustre@vdom@vnode:element(RSX))
) -> lustre@vdom@vnode:element(RSX).
head(Attrs, Children) ->
    lustre@element:element(<<"head"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 38).
?DOC("\n").
-spec link(list(lustre@vdom@vattr:attribute(RTD))) -> lustre@vdom@vnode:element(RTD).
link(Attrs) ->
    lustre@element:element(<<"link"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 43).
?DOC("\n").
-spec meta(list(lustre@vdom@vattr:attribute(RTH))) -> lustre@vdom@vnode:element(RTH).
meta(Attrs) ->
    lustre@element:element(<<"meta"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 48).
?DOC("\n").
-spec style(list(lustre@vdom@vattr:attribute(RTL)), binary()) -> lustre@vdom@vnode:element(RTL).
style(Attrs, Css) ->
    lustre@element:unsafe_raw_html(<<""/utf8>>, <<"style"/utf8>>, Attrs, Css).

-file("src/lustre/element/html.gleam", 53).
?DOC("\n").
-spec title(list(lustre@vdom@vattr:attribute(RTP)), binary()) -> lustre@vdom@vnode:element(RTP).
title(Attrs, Content) ->
    lustre@element:element(<<"title"/utf8>>, Attrs, [text(Content)]).

-file("src/lustre/element/html.gleam", 63).
?DOC("\n").
-spec body(
    list(lustre@vdom@vattr:attribute(RTT)),
    list(lustre@vdom@vnode:element(RTT))
) -> lustre@vdom@vnode:element(RTT).
body(Attrs, Children) ->
    lustre@element:element(<<"body"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 73).
?DOC("\n").
-spec address(
    list(lustre@vdom@vattr:attribute(RTZ)),
    list(lustre@vdom@vnode:element(RTZ))
) -> lustre@vdom@vnode:element(RTZ).
address(Attrs, Children) ->
    lustre@element:element(<<"address"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 81).
?DOC("\n").
-spec article(
    list(lustre@vdom@vattr:attribute(RUF)),
    list(lustre@vdom@vnode:element(RUF))
) -> lustre@vdom@vnode:element(RUF).
article(Attrs, Children) ->
    lustre@element:element(<<"article"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 89).
?DOC("\n").
-spec aside(
    list(lustre@vdom@vattr:attribute(RUL)),
    list(lustre@vdom@vnode:element(RUL))
) -> lustre@vdom@vnode:element(RUL).
aside(Attrs, Children) ->
    lustre@element:element(<<"aside"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 97).
?DOC("\n").
-spec footer(
    list(lustre@vdom@vattr:attribute(RUR)),
    list(lustre@vdom@vnode:element(RUR))
) -> lustre@vdom@vnode:element(RUR).
footer(Attrs, Children) ->
    lustre@element:element(<<"footer"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 105).
?DOC("\n").
-spec header(
    list(lustre@vdom@vattr:attribute(RUX)),
    list(lustre@vdom@vnode:element(RUX))
) -> lustre@vdom@vnode:element(RUX).
header(Attrs, Children) ->
    lustre@element:element(<<"header"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 113).
?DOC("\n").
-spec h1(
    list(lustre@vdom@vattr:attribute(RVD)),
    list(lustre@vdom@vnode:element(RVD))
) -> lustre@vdom@vnode:element(RVD).
h1(Attrs, Children) ->
    lustre@element:element(<<"h1"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 121).
?DOC("\n").
-spec h2(
    list(lustre@vdom@vattr:attribute(RVJ)),
    list(lustre@vdom@vnode:element(RVJ))
) -> lustre@vdom@vnode:element(RVJ).
h2(Attrs, Children) ->
    lustre@element:element(<<"h2"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 129).
?DOC("\n").
-spec h3(
    list(lustre@vdom@vattr:attribute(RVP)),
    list(lustre@vdom@vnode:element(RVP))
) -> lustre@vdom@vnode:element(RVP).
h3(Attrs, Children) ->
    lustre@element:element(<<"h3"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 137).
?DOC("\n").
-spec h4(
    list(lustre@vdom@vattr:attribute(RVV)),
    list(lustre@vdom@vnode:element(RVV))
) -> lustre@vdom@vnode:element(RVV).
h4(Attrs, Children) ->
    lustre@element:element(<<"h4"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 145).
?DOC("\n").
-spec h5(
    list(lustre@vdom@vattr:attribute(RWB)),
    list(lustre@vdom@vnode:element(RWB))
) -> lustre@vdom@vnode:element(RWB).
h5(Attrs, Children) ->
    lustre@element:element(<<"h5"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 153).
?DOC("\n").
-spec h6(
    list(lustre@vdom@vattr:attribute(RWH)),
    list(lustre@vdom@vnode:element(RWH))
) -> lustre@vdom@vnode:element(RWH).
h6(Attrs, Children) ->
    lustre@element:element(<<"h6"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 161).
?DOC("\n").
-spec hgroup(
    list(lustre@vdom@vattr:attribute(RWN)),
    list(lustre@vdom@vnode:element(RWN))
) -> lustre@vdom@vnode:element(RWN).
hgroup(Attrs, Children) ->
    lustre@element:element(<<"hgroup"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 169).
?DOC("\n").
-spec main(
    list(lustre@vdom@vattr:attribute(RWT)),
    list(lustre@vdom@vnode:element(RWT))
) -> lustre@vdom@vnode:element(RWT).
main(Attrs, Children) ->
    lustre@element:element(<<"main"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 177).
?DOC("\n").
-spec nav(
    list(lustre@vdom@vattr:attribute(RWZ)),
    list(lustre@vdom@vnode:element(RWZ))
) -> lustre@vdom@vnode:element(RWZ).
nav(Attrs, Children) ->
    lustre@element:element(<<"nav"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 185).
?DOC("\n").
-spec section(
    list(lustre@vdom@vattr:attribute(RXF)),
    list(lustre@vdom@vnode:element(RXF))
) -> lustre@vdom@vnode:element(RXF).
section(Attrs, Children) ->
    lustre@element:element(<<"section"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 193).
?DOC("\n").
-spec search(
    list(lustre@vdom@vattr:attribute(RXL)),
    list(lustre@vdom@vnode:element(RXL))
) -> lustre@vdom@vnode:element(RXL).
search(Attrs, Children) ->
    lustre@element:element(<<"search"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 203).
?DOC("\n").
-spec blockquote(
    list(lustre@vdom@vattr:attribute(RXR)),
    list(lustre@vdom@vnode:element(RXR))
) -> lustre@vdom@vnode:element(RXR).
blockquote(Attrs, Children) ->
    lustre@element:element(<<"blockquote"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 211).
?DOC("\n").
-spec dd(
    list(lustre@vdom@vattr:attribute(RXX)),
    list(lustre@vdom@vnode:element(RXX))
) -> lustre@vdom@vnode:element(RXX).
dd(Attrs, Children) ->
    lustre@element:element(<<"dd"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 219).
?DOC("\n").
-spec 'div'(
    list(lustre@vdom@vattr:attribute(RYD)),
    list(lustre@vdom@vnode:element(RYD))
) -> lustre@vdom@vnode:element(RYD).
'div'(Attrs, Children) ->
    lustre@element:element(<<"div"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 227).
?DOC("\n").
-spec dl(
    list(lustre@vdom@vattr:attribute(RYJ)),
    list(lustre@vdom@vnode:element(RYJ))
) -> lustre@vdom@vnode:element(RYJ).
dl(Attrs, Children) ->
    lustre@element:element(<<"dl"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 235).
?DOC("\n").
-spec dt(
    list(lustre@vdom@vattr:attribute(RYP)),
    list(lustre@vdom@vnode:element(RYP))
) -> lustre@vdom@vnode:element(RYP).
dt(Attrs, Children) ->
    lustre@element:element(<<"dt"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 243).
?DOC("\n").
-spec figcaption(
    list(lustre@vdom@vattr:attribute(RYV)),
    list(lustre@vdom@vnode:element(RYV))
) -> lustre@vdom@vnode:element(RYV).
figcaption(Attrs, Children) ->
    lustre@element:element(<<"figcaption"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 251).
?DOC("\n").
-spec figure(
    list(lustre@vdom@vattr:attribute(RZB)),
    list(lustre@vdom@vnode:element(RZB))
) -> lustre@vdom@vnode:element(RZB).
figure(Attrs, Children) ->
    lustre@element:element(<<"figure"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 259).
?DOC("\n").
-spec hr(list(lustre@vdom@vattr:attribute(RZH))) -> lustre@vdom@vnode:element(RZH).
hr(Attrs) ->
    lustre@element:element(<<"hr"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 264).
?DOC("\n").
-spec li(
    list(lustre@vdom@vattr:attribute(RZL)),
    list(lustre@vdom@vnode:element(RZL))
) -> lustre@vdom@vnode:element(RZL).
li(Attrs, Children) ->
    lustre@element:element(<<"li"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 272).
?DOC("\n").
-spec menu(
    list(lustre@vdom@vattr:attribute(RZR)),
    list(lustre@vdom@vnode:element(RZR))
) -> lustre@vdom@vnode:element(RZR).
menu(Attrs, Children) ->
    lustre@element:element(<<"menu"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 280).
?DOC("\n").
-spec ol(
    list(lustre@vdom@vattr:attribute(RZX)),
    list(lustre@vdom@vnode:element(RZX))
) -> lustre@vdom@vnode:element(RZX).
ol(Attrs, Children) ->
    lustre@element:element(<<"ol"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 288).
?DOC("\n").
-spec p(
    list(lustre@vdom@vattr:attribute(SAD)),
    list(lustre@vdom@vnode:element(SAD))
) -> lustre@vdom@vnode:element(SAD).
p(Attrs, Children) ->
    lustre@element:element(<<"p"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 296).
?DOC("\n").
-spec pre(
    list(lustre@vdom@vattr:attribute(SAJ)),
    list(lustre@vdom@vnode:element(SAJ))
) -> lustre@vdom@vnode:element(SAJ).
pre(Attrs, Children) ->
    lustre@element:element(<<"pre"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 304).
?DOC("\n").
-spec ul(
    list(lustre@vdom@vattr:attribute(SAP)),
    list(lustre@vdom@vnode:element(SAP))
) -> lustre@vdom@vnode:element(SAP).
ul(Attrs, Children) ->
    lustre@element:element(<<"ul"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 314).
?DOC("\n").
-spec a(
    list(lustre@vdom@vattr:attribute(SAV)),
    list(lustre@vdom@vnode:element(SAV))
) -> lustre@vdom@vnode:element(SAV).
a(Attrs, Children) ->
    lustre@element:element(<<"a"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 322).
?DOC("\n").
-spec abbr(
    list(lustre@vdom@vattr:attribute(SBB)),
    list(lustre@vdom@vnode:element(SBB))
) -> lustre@vdom@vnode:element(SBB).
abbr(Attrs, Children) ->
    lustre@element:element(<<"abbr"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 330).
?DOC("\n").
-spec b(
    list(lustre@vdom@vattr:attribute(SBH)),
    list(lustre@vdom@vnode:element(SBH))
) -> lustre@vdom@vnode:element(SBH).
b(Attrs, Children) ->
    lustre@element:element(<<"b"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 338).
?DOC("\n").
-spec bdi(
    list(lustre@vdom@vattr:attribute(SBN)),
    list(lustre@vdom@vnode:element(SBN))
) -> lustre@vdom@vnode:element(SBN).
bdi(Attrs, Children) ->
    lustre@element:element(<<"bdi"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 346).
?DOC("\n").
-spec bdo(
    list(lustre@vdom@vattr:attribute(SBT)),
    list(lustre@vdom@vnode:element(SBT))
) -> lustre@vdom@vnode:element(SBT).
bdo(Attrs, Children) ->
    lustre@element:element(<<"bdo"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 354).
?DOC("\n").
-spec br(list(lustre@vdom@vattr:attribute(SBZ))) -> lustre@vdom@vnode:element(SBZ).
br(Attrs) ->
    lustre@element:element(<<"br"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 359).
?DOC("\n").
-spec cite(
    list(lustre@vdom@vattr:attribute(SCD)),
    list(lustre@vdom@vnode:element(SCD))
) -> lustre@vdom@vnode:element(SCD).
cite(Attrs, Children) ->
    lustre@element:element(<<"cite"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 367).
?DOC("\n").
-spec code(
    list(lustre@vdom@vattr:attribute(SCJ)),
    list(lustre@vdom@vnode:element(SCJ))
) -> lustre@vdom@vnode:element(SCJ).
code(Attrs, Children) ->
    lustre@element:element(<<"code"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 375).
?DOC("\n").
-spec data(
    list(lustre@vdom@vattr:attribute(SCP)),
    list(lustre@vdom@vnode:element(SCP))
) -> lustre@vdom@vnode:element(SCP).
data(Attrs, Children) ->
    lustre@element:element(<<"data"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 383).
?DOC("\n").
-spec dfn(
    list(lustre@vdom@vattr:attribute(SCV)),
    list(lustre@vdom@vnode:element(SCV))
) -> lustre@vdom@vnode:element(SCV).
dfn(Attrs, Children) ->
    lustre@element:element(<<"dfn"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 391).
?DOC("\n").
-spec em(
    list(lustre@vdom@vattr:attribute(SDB)),
    list(lustre@vdom@vnode:element(SDB))
) -> lustre@vdom@vnode:element(SDB).
em(Attrs, Children) ->
    lustre@element:element(<<"em"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 399).
?DOC("\n").
-spec i(
    list(lustre@vdom@vattr:attribute(SDH)),
    list(lustre@vdom@vnode:element(SDH))
) -> lustre@vdom@vnode:element(SDH).
i(Attrs, Children) ->
    lustre@element:element(<<"i"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 407).
?DOC("\n").
-spec kbd(
    list(lustre@vdom@vattr:attribute(SDN)),
    list(lustre@vdom@vnode:element(SDN))
) -> lustre@vdom@vnode:element(SDN).
kbd(Attrs, Children) ->
    lustre@element:element(<<"kbd"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 415).
?DOC("\n").
-spec mark(
    list(lustre@vdom@vattr:attribute(SDT)),
    list(lustre@vdom@vnode:element(SDT))
) -> lustre@vdom@vnode:element(SDT).
mark(Attrs, Children) ->
    lustre@element:element(<<"mark"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 423).
?DOC("\n").
-spec q(
    list(lustre@vdom@vattr:attribute(SDZ)),
    list(lustre@vdom@vnode:element(SDZ))
) -> lustre@vdom@vnode:element(SDZ).
q(Attrs, Children) ->
    lustre@element:element(<<"q"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 431).
?DOC("\n").
-spec rp(
    list(lustre@vdom@vattr:attribute(SEF)),
    list(lustre@vdom@vnode:element(SEF))
) -> lustre@vdom@vnode:element(SEF).
rp(Attrs, Children) ->
    lustre@element:element(<<"rp"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 439).
?DOC("\n").
-spec rt(
    list(lustre@vdom@vattr:attribute(SEL)),
    list(lustre@vdom@vnode:element(SEL))
) -> lustre@vdom@vnode:element(SEL).
rt(Attrs, Children) ->
    lustre@element:element(<<"rt"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 447).
?DOC("\n").
-spec ruby(
    list(lustre@vdom@vattr:attribute(SER)),
    list(lustre@vdom@vnode:element(SER))
) -> lustre@vdom@vnode:element(SER).
ruby(Attrs, Children) ->
    lustre@element:element(<<"ruby"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 455).
?DOC("\n").
-spec s(
    list(lustre@vdom@vattr:attribute(SEX)),
    list(lustre@vdom@vnode:element(SEX))
) -> lustre@vdom@vnode:element(SEX).
s(Attrs, Children) ->
    lustre@element:element(<<"s"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 463).
?DOC("\n").
-spec samp(
    list(lustre@vdom@vattr:attribute(SFD)),
    list(lustre@vdom@vnode:element(SFD))
) -> lustre@vdom@vnode:element(SFD).
samp(Attrs, Children) ->
    lustre@element:element(<<"samp"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 471).
?DOC("\n").
-spec small(
    list(lustre@vdom@vattr:attribute(SFJ)),
    list(lustre@vdom@vnode:element(SFJ))
) -> lustre@vdom@vnode:element(SFJ).
small(Attrs, Children) ->
    lustre@element:element(<<"small"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 479).
?DOC("\n").
-spec span(
    list(lustre@vdom@vattr:attribute(SFP)),
    list(lustre@vdom@vnode:element(SFP))
) -> lustre@vdom@vnode:element(SFP).
span(Attrs, Children) ->
    lustre@element:element(<<"span"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 487).
?DOC("\n").
-spec strong(
    list(lustre@vdom@vattr:attribute(SFV)),
    list(lustre@vdom@vnode:element(SFV))
) -> lustre@vdom@vnode:element(SFV).
strong(Attrs, Children) ->
    lustre@element:element(<<"strong"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 495).
?DOC("\n").
-spec sub(
    list(lustre@vdom@vattr:attribute(SGB)),
    list(lustre@vdom@vnode:element(SGB))
) -> lustre@vdom@vnode:element(SGB).
sub(Attrs, Children) ->
    lustre@element:element(<<"sub"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 503).
?DOC("\n").
-spec sup(
    list(lustre@vdom@vattr:attribute(SGH)),
    list(lustre@vdom@vnode:element(SGH))
) -> lustre@vdom@vnode:element(SGH).
sup(Attrs, Children) ->
    lustre@element:element(<<"sup"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 511).
?DOC("\n").
-spec time(
    list(lustre@vdom@vattr:attribute(SGN)),
    list(lustre@vdom@vnode:element(SGN))
) -> lustre@vdom@vnode:element(SGN).
time(Attrs, Children) ->
    lustre@element:element(<<"time"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 519).
?DOC("\n").
-spec u(
    list(lustre@vdom@vattr:attribute(SGT)),
    list(lustre@vdom@vnode:element(SGT))
) -> lustre@vdom@vnode:element(SGT).
u(Attrs, Children) ->
    lustre@element:element(<<"u"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 527).
?DOC("\n").
-spec var(
    list(lustre@vdom@vattr:attribute(SGZ)),
    list(lustre@vdom@vnode:element(SGZ))
) -> lustre@vdom@vnode:element(SGZ).
var(Attrs, Children) ->
    lustre@element:element(<<"var"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 535).
?DOC("\n").
-spec wbr(list(lustre@vdom@vattr:attribute(SHF))) -> lustre@vdom@vnode:element(SHF).
wbr(Attrs) ->
    lustre@element:element(<<"wbr"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 542).
?DOC("\n").
-spec area(list(lustre@vdom@vattr:attribute(SHJ))) -> lustre@vdom@vnode:element(SHJ).
area(Attrs) ->
    lustre@element:element(<<"area"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 547).
?DOC("\n").
-spec audio(
    list(lustre@vdom@vattr:attribute(SHN)),
    list(lustre@vdom@vnode:element(SHN))
) -> lustre@vdom@vnode:element(SHN).
audio(Attrs, Children) ->
    lustre@element:element(<<"audio"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 555).
?DOC("\n").
-spec img(list(lustre@vdom@vattr:attribute(SHT))) -> lustre@vdom@vnode:element(SHT).
img(Attrs) ->
    lustre@element:element(<<"img"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 561).
?DOC(" Used with <area> elements to define an image map (a clickable link area).\n").
-spec map(
    list(lustre@vdom@vattr:attribute(SHX)),
    list(lustre@vdom@vnode:element(SHX))
) -> lustre@vdom@vnode:element(SHX).
map(Attrs, Children) ->
    lustre@element:element(<<"map"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 569).
?DOC("\n").
-spec track(list(lustre@vdom@vattr:attribute(SID))) -> lustre@vdom@vnode:element(SID).
track(Attrs) ->
    lustre@element:element(<<"track"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 574).
?DOC("\n").
-spec video(
    list(lustre@vdom@vattr:attribute(SIH)),
    list(lustre@vdom@vnode:element(SIH))
) -> lustre@vdom@vnode:element(SIH).
video(Attrs, Children) ->
    lustre@element:element(<<"video"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 584).
?DOC("\n").
-spec embed(list(lustre@vdom@vattr:attribute(SIN))) -> lustre@vdom@vnode:element(SIN).
embed(Attrs) ->
    lustre@element:element(<<"embed"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 589).
?DOC("\n").
-spec iframe(list(lustre@vdom@vattr:attribute(SIR))) -> lustre@vdom@vnode:element(SIR).
iframe(Attrs) ->
    lustre@element:element(<<"iframe"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 594).
?DOC("\n").
-spec object(list(lustre@vdom@vattr:attribute(SIV))) -> lustre@vdom@vnode:element(SIV).
object(Attrs) ->
    lustre@element:element(<<"object"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 599).
?DOC("\n").
-spec picture(
    list(lustre@vdom@vattr:attribute(SIZ)),
    list(lustre@vdom@vnode:element(SIZ))
) -> lustre@vdom@vnode:element(SIZ).
picture(Attrs, Children) ->
    lustre@element:element(<<"picture"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 607).
?DOC("\n").
-spec portal(list(lustre@vdom@vattr:attribute(SJF))) -> lustre@vdom@vnode:element(SJF).
portal(Attrs) ->
    lustre@element:element(<<"portal"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 612).
?DOC("\n").
-spec source(list(lustre@vdom@vattr:attribute(SJJ))) -> lustre@vdom@vnode:element(SJJ).
source(Attrs) ->
    lustre@element:element(<<"source"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 619).
?DOC("\n").
-spec math(
    list(lustre@vdom@vattr:attribute(SJN)),
    list(lustre@vdom@vnode:element(SJN))
) -> lustre@vdom@vnode:element(SJN).
math(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/1998/Math/MathML"/utf8>>,
        <<"math"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/html.gleam", 627).
?DOC("\n").
-spec svg(
    list(lustre@vdom@vattr:attribute(SJT)),
    list(lustre@vdom@vnode:element(SJT))
) -> lustre@vdom@vnode:element(SJT).
svg(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"svg"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/html.gleam", 637).
?DOC("\n").
-spec canvas(list(lustre@vdom@vattr:attribute(SJZ))) -> lustre@vdom@vnode:element(SJZ).
canvas(Attrs) ->
    lustre@element:element(<<"canvas"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 642).
?DOC("\n").
-spec noscript(
    list(lustre@vdom@vattr:attribute(SKD)),
    list(lustre@vdom@vnode:element(SKD))
) -> lustre@vdom@vnode:element(SKD).
noscript(Attrs, Children) ->
    lustre@element:element(<<"noscript"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 650).
?DOC("\n").
-spec script(list(lustre@vdom@vattr:attribute(SKJ)), binary()) -> lustre@vdom@vnode:element(SKJ).
script(Attrs, Js) ->
    lustre@element:unsafe_raw_html(<<""/utf8>>, <<"script"/utf8>>, Attrs, Js).

-file("src/lustre/element/html.gleam", 657).
?DOC("\n").
-spec del(
    list(lustre@vdom@vattr:attribute(SKN)),
    list(lustre@vdom@vnode:element(SKN))
) -> lustre@vdom@vnode:element(SKN).
del(Attrs, Children) ->
    lustre@element:element(<<"del"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 665).
?DOC("\n").
-spec ins(
    list(lustre@vdom@vattr:attribute(SKT)),
    list(lustre@vdom@vnode:element(SKT))
) -> lustre@vdom@vnode:element(SKT).
ins(Attrs, Children) ->
    lustre@element:element(<<"ins"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 675).
?DOC("\n").
-spec caption(
    list(lustre@vdom@vattr:attribute(SKZ)),
    list(lustre@vdom@vnode:element(SKZ))
) -> lustre@vdom@vnode:element(SKZ).
caption(Attrs, Children) ->
    lustre@element:element(<<"caption"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 683).
?DOC("\n").
-spec col(list(lustre@vdom@vattr:attribute(SLF))) -> lustre@vdom@vnode:element(SLF).
col(Attrs) ->
    lustre@element:element(<<"col"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 688).
?DOC("\n").
-spec colgroup(
    list(lustre@vdom@vattr:attribute(SLJ)),
    list(lustre@vdom@vnode:element(SLJ))
) -> lustre@vdom@vnode:element(SLJ).
colgroup(Attrs, Children) ->
    lustre@element:element(<<"colgroup"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 696).
?DOC("\n").
-spec table(
    list(lustre@vdom@vattr:attribute(SLP)),
    list(lustre@vdom@vnode:element(SLP))
) -> lustre@vdom@vnode:element(SLP).
table(Attrs, Children) ->
    lustre@element:element(<<"table"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 704).
?DOC("\n").
-spec tbody(
    list(lustre@vdom@vattr:attribute(SLV)),
    list(lustre@vdom@vnode:element(SLV))
) -> lustre@vdom@vnode:element(SLV).
tbody(Attrs, Children) ->
    lustre@element:element(<<"tbody"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 712).
?DOC("\n").
-spec td(
    list(lustre@vdom@vattr:attribute(SMB)),
    list(lustre@vdom@vnode:element(SMB))
) -> lustre@vdom@vnode:element(SMB).
td(Attrs, Children) ->
    lustre@element:element(<<"td"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 720).
?DOC("\n").
-spec tfoot(
    list(lustre@vdom@vattr:attribute(SMH)),
    list(lustre@vdom@vnode:element(SMH))
) -> lustre@vdom@vnode:element(SMH).
tfoot(Attrs, Children) ->
    lustre@element:element(<<"tfoot"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 728).
?DOC("\n").
-spec th(
    list(lustre@vdom@vattr:attribute(SMN)),
    list(lustre@vdom@vnode:element(SMN))
) -> lustre@vdom@vnode:element(SMN).
th(Attrs, Children) ->
    lustre@element:element(<<"th"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 736).
?DOC("\n").
-spec thead(
    list(lustre@vdom@vattr:attribute(SMT)),
    list(lustre@vdom@vnode:element(SMT))
) -> lustre@vdom@vnode:element(SMT).
thead(Attrs, Children) ->
    lustre@element:element(<<"thead"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 744).
?DOC("\n").
-spec tr(
    list(lustre@vdom@vattr:attribute(SMZ)),
    list(lustre@vdom@vnode:element(SMZ))
) -> lustre@vdom@vnode:element(SMZ).
tr(Attrs, Children) ->
    lustre@element:element(<<"tr"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 754).
?DOC("\n").
-spec button(
    list(lustre@vdom@vattr:attribute(SNF)),
    list(lustre@vdom@vnode:element(SNF))
) -> lustre@vdom@vnode:element(SNF).
button(Attrs, Children) ->
    lustre@element:element(<<"button"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 762).
?DOC("\n").
-spec datalist(
    list(lustre@vdom@vattr:attribute(SNL)),
    list(lustre@vdom@vnode:element(SNL))
) -> lustre@vdom@vnode:element(SNL).
datalist(Attrs, Children) ->
    lustre@element:element(<<"datalist"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 770).
?DOC("\n").
-spec fieldset(
    list(lustre@vdom@vattr:attribute(SNR)),
    list(lustre@vdom@vnode:element(SNR))
) -> lustre@vdom@vnode:element(SNR).
fieldset(Attrs, Children) ->
    lustre@element:element(<<"fieldset"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 778).
?DOC("\n").
-spec form(
    list(lustre@vdom@vattr:attribute(SNX)),
    list(lustre@vdom@vnode:element(SNX))
) -> lustre@vdom@vnode:element(SNX).
form(Attrs, Children) ->
    lustre@element:element(<<"form"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 786).
?DOC("\n").
-spec input(list(lustre@vdom@vattr:attribute(SOD))) -> lustre@vdom@vnode:element(SOD).
input(Attrs) ->
    lustre@element:element(<<"input"/utf8>>, Attrs, []).

-file("src/lustre/element/html.gleam", 791).
?DOC("\n").
-spec label(
    list(lustre@vdom@vattr:attribute(SOH)),
    list(lustre@vdom@vnode:element(SOH))
) -> lustre@vdom@vnode:element(SOH).
label(Attrs, Children) ->
    lustre@element:element(<<"label"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 799).
?DOC("\n").
-spec legend(
    list(lustre@vdom@vattr:attribute(SON)),
    list(lustre@vdom@vnode:element(SON))
) -> lustre@vdom@vnode:element(SON).
legend(Attrs, Children) ->
    lustre@element:element(<<"legend"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 807).
?DOC("\n").
-spec meter(
    list(lustre@vdom@vattr:attribute(SOT)),
    list(lustre@vdom@vnode:element(SOT))
) -> lustre@vdom@vnode:element(SOT).
meter(Attrs, Children) ->
    lustre@element:element(<<"meter"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 815).
?DOC("\n").
-spec optgroup(
    list(lustre@vdom@vattr:attribute(SOZ)),
    list(lustre@vdom@vnode:element(SOZ))
) -> lustre@vdom@vnode:element(SOZ).
optgroup(Attrs, Children) ->
    lustre@element:element(<<"optgroup"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 823).
?DOC("\n").
-spec option(list(lustre@vdom@vattr:attribute(SPF)), binary()) -> lustre@vdom@vnode:element(SPF).
option(Attrs, Label) ->
    lustre@element:element(
        <<"option"/utf8>>,
        Attrs,
        [lustre@element:text(Label)]
    ).

-file("src/lustre/element/html.gleam", 831).
?DOC("\n").
-spec output(
    list(lustre@vdom@vattr:attribute(SPJ)),
    list(lustre@vdom@vnode:element(SPJ))
) -> lustre@vdom@vnode:element(SPJ).
output(Attrs, Children) ->
    lustre@element:element(<<"output"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 839).
?DOC("\n").
-spec progress(
    list(lustre@vdom@vattr:attribute(SPP)),
    list(lustre@vdom@vnode:element(SPP))
) -> lustre@vdom@vnode:element(SPP).
progress(Attrs, Children) ->
    lustre@element:element(<<"progress"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 847).
?DOC("\n").
-spec select(
    list(lustre@vdom@vattr:attribute(SPV)),
    list(lustre@vdom@vnode:element(SPV))
) -> lustre@vdom@vnode:element(SPV).
select(Attrs, Children) ->
    lustre@element:element(<<"select"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 855).
?DOC("\n").
-spec textarea(list(lustre@vdom@vattr:attribute(SQB)), binary()) -> lustre@vdom@vnode:element(SQB).
textarea(Attrs, Content) ->
    lustre@element:element(
        <<"textarea"/utf8>>,
        [lustre@attribute:property(<<"value"/utf8>>, gleam@json:string(Content)) |
            Attrs],
        [lustre@element:text(Content)]
    ).

-file("src/lustre/element/html.gleam", 869).
?DOC("\n").
-spec details(
    list(lustre@vdom@vattr:attribute(SQF)),
    list(lustre@vdom@vnode:element(SQF))
) -> lustre@vdom@vnode:element(SQF).
details(Attrs, Children) ->
    lustre@element:element(<<"details"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 877).
?DOC("\n").
-spec dialog(
    list(lustre@vdom@vattr:attribute(SQL)),
    list(lustre@vdom@vnode:element(SQL))
) -> lustre@vdom@vnode:element(SQL).
dialog(Attrs, Children) ->
    lustre@element:element(<<"dialog"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 885).
?DOC("\n").
-spec summary(
    list(lustre@vdom@vattr:attribute(SQR)),
    list(lustre@vdom@vnode:element(SQR))
) -> lustre@vdom@vnode:element(SQR).
summary(Attrs, Children) ->
    lustre@element:element(<<"summary"/utf8>>, Attrs, Children).

-file("src/lustre/element/html.gleam", 895).
?DOC("\n").
-spec slot(
    list(lustre@vdom@vattr:attribute(SQX)),
    list(lustre@vdom@vnode:element(SQX))
) -> lustre@vdom@vnode:element(SQX).
slot(Attrs, Fallback) ->
    lustre@element:element(<<"slot"/utf8>>, Attrs, Fallback).

-file("src/lustre/element/html.gleam", 903).
?DOC("\n").
-spec template(
    list(lustre@vdom@vattr:attribute(SRD)),
    list(lustre@vdom@vnode:element(SRD))
) -> lustre@vdom@vnode:element(SRD).
template(Attrs, Children) ->
    lustre@element:element(<<"template"/utf8>>, Attrs, Children).
