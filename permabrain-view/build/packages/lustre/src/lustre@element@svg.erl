-module(lustre@element@svg).
-compile([no_auto_import, nowarn_unused_vars, nowarn_unused_function, nowarn_nomatch, inline]).
-define(FILEPATH, "src/lustre/element/svg.gleam").
-export([animate/1, animate_motion/1, animate_transform/1, mpath/1, set/1, circle/1, ellipse/1, line/1, polygon/1, polyline/1, rect/1, a/2, defs/2, g/2, marker/2, mask/2, missing_glyph/2, pattern/2, svg/2, switch/2, symbol/2, view/2, desc/2, metadata/2, title/2, filter/2, fe_blend/1, fe_color_matrix/1, fe_component_transfer/1, fe_composite/1, fe_convolve_matrix/1, fe_diffuse_lighting/2, fe_displacement_map/1, fe_drop_shadow/1, fe_flood/1, fe_func_a/1, fe_func_b/1, fe_func_g/1, fe_func_r/1, fe_gaussian_blur/1, fe_image/1, fe_merge/2, fe_merge_node/1, fe_morphology/1, fe_offset/1, fe_specular_lighting/2, fe_tile/2, fe_turbulence/1, linear_gradient/2, radial_gradient/2, stop/1, image/1, path/1, text/2, use_/1, fe_distant_light/1, fe_point_light/1, fe_spot_light/1, clip_path/2, script/2, style/2, foreign_object/2, text_path/2, tspan/2]).

-if(?OTP_RELEASE >= 27).
-define(MODULEDOC(Str), -moduledoc(Str)).
-define(DOC(Str), -doc(Str)).
-else.
-define(MODULEDOC(Str), -compile([])).
-define(DOC(Str), -compile([])).
-endif.

-file("src/lustre/element/svg.gleam", 24).
?DOC("\n").
-spec animate(list(lustre@vdom@vattr:attribute(YJE))) -> lustre@vdom@vnode:element(YJE).
animate(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"animate"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 29).
?DOC("\n").
-spec animate_motion(list(lustre@vdom@vattr:attribute(YJI))) -> lustre@vdom@vnode:element(YJI).
animate_motion(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"animateMotion"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 34).
?DOC("\n").
-spec animate_transform(list(lustre@vdom@vattr:attribute(YJM))) -> lustre@vdom@vnode:element(YJM).
animate_transform(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"animateTransform"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 39).
?DOC("\n").
-spec mpath(list(lustre@vdom@vattr:attribute(YJQ))) -> lustre@vdom@vnode:element(YJQ).
mpath(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"mpath"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 44).
?DOC("\n").
-spec set(list(lustre@vdom@vattr:attribute(YJU))) -> lustre@vdom@vnode:element(YJU).
set(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"set"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 51).
?DOC("\n").
-spec circle(list(lustre@vdom@vattr:attribute(YJY))) -> lustre@vdom@vnode:element(YJY).
circle(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"circle"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 56).
?DOC("\n").
-spec ellipse(list(lustre@vdom@vattr:attribute(YKC))) -> lustre@vdom@vnode:element(YKC).
ellipse(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"ellipse"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 61).
?DOC("\n").
-spec line(list(lustre@vdom@vattr:attribute(YKG))) -> lustre@vdom@vnode:element(YKG).
line(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"line"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 66).
?DOC("\n").
-spec polygon(list(lustre@vdom@vattr:attribute(YKK))) -> lustre@vdom@vnode:element(YKK).
polygon(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"polygon"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 71).
?DOC("\n").
-spec polyline(list(lustre@vdom@vattr:attribute(YKO))) -> lustre@vdom@vnode:element(YKO).
polyline(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"polyline"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 76).
?DOC("\n").
-spec rect(list(lustre@vdom@vattr:attribute(YKS))) -> lustre@vdom@vnode:element(YKS).
rect(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"rect"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 83).
?DOC("\n").
-spec a(
    list(lustre@vdom@vattr:attribute(YKW)),
    list(lustre@vdom@vnode:element(YKW))
) -> lustre@vdom@vnode:element(YKW).
a(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"a"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 91).
?DOC("\n").
-spec defs(
    list(lustre@vdom@vattr:attribute(YLC)),
    list(lustre@vdom@vnode:element(YLC))
) -> lustre@vdom@vnode:element(YLC).
defs(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"defs"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 99).
?DOC("\n").
-spec g(
    list(lustre@vdom@vattr:attribute(YLI)),
    list(lustre@vdom@vnode:element(YLI))
) -> lustre@vdom@vnode:element(YLI).
g(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"g"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 107).
?DOC("\n").
-spec marker(
    list(lustre@vdom@vattr:attribute(YLO)),
    list(lustre@vdom@vnode:element(YLO))
) -> lustre@vdom@vnode:element(YLO).
marker(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"marker"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 115).
?DOC("\n").
-spec mask(
    list(lustre@vdom@vattr:attribute(YLU)),
    list(lustre@vdom@vnode:element(YLU))
) -> lustre@vdom@vnode:element(YLU).
mask(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"mask"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 123).
?DOC("\n").
-spec missing_glyph(
    list(lustre@vdom@vattr:attribute(YMA)),
    list(lustre@vdom@vnode:element(YMA))
) -> lustre@vdom@vnode:element(YMA).
missing_glyph(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"missing-glyph"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 131).
?DOC("\n").
-spec pattern(
    list(lustre@vdom@vattr:attribute(YMG)),
    list(lustre@vdom@vnode:element(YMG))
) -> lustre@vdom@vnode:element(YMG).
pattern(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"pattern"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 139).
?DOC("\n").
-spec svg(
    list(lustre@vdom@vattr:attribute(YMM)),
    list(lustre@vdom@vnode:element(YMM))
) -> lustre@vdom@vnode:element(YMM).
svg(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"svg"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 147).
?DOC("\n").
-spec switch(
    list(lustre@vdom@vattr:attribute(YMS)),
    list(lustre@vdom@vnode:element(YMS))
) -> lustre@vdom@vnode:element(YMS).
switch(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"switch"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 155).
?DOC("\n").
-spec symbol(
    list(lustre@vdom@vattr:attribute(YMY)),
    list(lustre@vdom@vnode:element(YMY))
) -> lustre@vdom@vnode:element(YMY).
symbol(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"symbol"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 163).
?DOC("\n").
-spec view(
    list(lustre@vdom@vattr:attribute(YNE)),
    list(lustre@vdom@vnode:element(YNE))
) -> lustre@vdom@vnode:element(YNE).
view(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"view"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 173).
?DOC("\n").
-spec desc(
    list(lustre@vdom@vattr:attribute(YNK)),
    list(lustre@vdom@vnode:element(YNK))
) -> lustre@vdom@vnode:element(YNK).
desc(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"desc"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 181).
?DOC("\n").
-spec metadata(
    list(lustre@vdom@vattr:attribute(YNQ)),
    list(lustre@vdom@vnode:element(YNQ))
) -> lustre@vdom@vnode:element(YNQ).
metadata(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"metadata"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 189).
?DOC("\n").
-spec title(
    list(lustre@vdom@vattr:attribute(YNW)),
    list(lustre@vdom@vnode:element(YNW))
) -> lustre@vdom@vnode:element(YNW).
title(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"title"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 199).
?DOC("\n").
-spec filter(
    list(lustre@vdom@vattr:attribute(YOC)),
    list(lustre@vdom@vnode:element(YOC))
) -> lustre@vdom@vnode:element(YOC).
filter(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"filter"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 207).
?DOC("\n").
-spec fe_blend(list(lustre@vdom@vattr:attribute(YOI))) -> lustre@vdom@vnode:element(YOI).
fe_blend(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feBlend"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 212).
?DOC("\n").
-spec fe_color_matrix(list(lustre@vdom@vattr:attribute(YOM))) -> lustre@vdom@vnode:element(YOM).
fe_color_matrix(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feColorMatrix"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 217).
?DOC("\n").
-spec fe_component_transfer(list(lustre@vdom@vattr:attribute(YOQ))) -> lustre@vdom@vnode:element(YOQ).
fe_component_transfer(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feComponentTransfer"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 224).
?DOC("\n").
-spec fe_composite(list(lustre@vdom@vattr:attribute(YOU))) -> lustre@vdom@vnode:element(YOU).
fe_composite(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feComposite"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 229).
?DOC("\n").
-spec fe_convolve_matrix(list(lustre@vdom@vattr:attribute(YOY))) -> lustre@vdom@vnode:element(YOY).
fe_convolve_matrix(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feConvolveMatrix"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 234).
?DOC("\n").
-spec fe_diffuse_lighting(
    list(lustre@vdom@vattr:attribute(YPC)),
    list(lustre@vdom@vnode:element(YPC))
) -> lustre@vdom@vnode:element(YPC).
fe_diffuse_lighting(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feDiffuseLighting"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 242).
?DOC("\n").
-spec fe_displacement_map(list(lustre@vdom@vattr:attribute(YPI))) -> lustre@vdom@vnode:element(YPI).
fe_displacement_map(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feDisplacementMap"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 247).
?DOC("\n").
-spec fe_drop_shadow(list(lustre@vdom@vattr:attribute(YPM))) -> lustre@vdom@vnode:element(YPM).
fe_drop_shadow(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feDropShadow"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 252).
?DOC("\n").
-spec fe_flood(list(lustre@vdom@vattr:attribute(YPQ))) -> lustre@vdom@vnode:element(YPQ).
fe_flood(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feFlood"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 257).
?DOC("\n").
-spec fe_func_a(list(lustre@vdom@vattr:attribute(YPU))) -> lustre@vdom@vnode:element(YPU).
fe_func_a(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feFuncA"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 262).
?DOC("\n").
-spec fe_func_b(list(lustre@vdom@vattr:attribute(YPY))) -> lustre@vdom@vnode:element(YPY).
fe_func_b(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feFuncB"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 267).
?DOC("\n").
-spec fe_func_g(list(lustre@vdom@vattr:attribute(YQC))) -> lustre@vdom@vnode:element(YQC).
fe_func_g(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feFuncG"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 272).
?DOC("\n").
-spec fe_func_r(list(lustre@vdom@vattr:attribute(YQG))) -> lustre@vdom@vnode:element(YQG).
fe_func_r(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feFuncR"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 277).
?DOC("\n").
-spec fe_gaussian_blur(list(lustre@vdom@vattr:attribute(YQK))) -> lustre@vdom@vnode:element(YQK).
fe_gaussian_blur(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feGaussianBlur"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 282).
?DOC("\n").
-spec fe_image(list(lustre@vdom@vattr:attribute(YQO))) -> lustre@vdom@vnode:element(YQO).
fe_image(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feImage"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 287).
?DOC("\n").
-spec fe_merge(
    list(lustre@vdom@vattr:attribute(YQS)),
    list(lustre@vdom@vnode:element(YQS))
) -> lustre@vdom@vnode:element(YQS).
fe_merge(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feMerge"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 295).
?DOC("\n").
-spec fe_merge_node(list(lustre@vdom@vattr:attribute(YQY))) -> lustre@vdom@vnode:element(YQY).
fe_merge_node(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feMergeNode"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 300).
?DOC("\n").
-spec fe_morphology(list(lustre@vdom@vattr:attribute(YRC))) -> lustre@vdom@vnode:element(YRC).
fe_morphology(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feMorphology"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 305).
?DOC("\n").
-spec fe_offset(list(lustre@vdom@vattr:attribute(YRG))) -> lustre@vdom@vnode:element(YRG).
fe_offset(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feOffset"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 310).
?DOC("\n").
-spec fe_specular_lighting(
    list(lustre@vdom@vattr:attribute(YRK)),
    list(lustre@vdom@vnode:element(YRK))
) -> lustre@vdom@vnode:element(YRK).
fe_specular_lighting(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feSpecularLighting"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 318).
?DOC("\n").
-spec fe_tile(
    list(lustre@vdom@vattr:attribute(YRQ)),
    list(lustre@vdom@vnode:element(YRQ))
) -> lustre@vdom@vnode:element(YRQ).
fe_tile(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feTile"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 326).
?DOC("\n").
-spec fe_turbulence(list(lustre@vdom@vattr:attribute(YRW))) -> lustre@vdom@vnode:element(YRW).
fe_turbulence(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feTurbulence"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 333).
?DOC("\n").
-spec linear_gradient(
    list(lustre@vdom@vattr:attribute(YSA)),
    list(lustre@vdom@vnode:element(YSA))
) -> lustre@vdom@vnode:element(YSA).
linear_gradient(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"linearGradient"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 341).
?DOC("\n").
-spec radial_gradient(
    list(lustre@vdom@vattr:attribute(YSG)),
    list(lustre@vdom@vnode:element(YSG))
) -> lustre@vdom@vnode:element(YSG).
radial_gradient(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"radialGradient"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 349).
?DOC("\n").
-spec stop(list(lustre@vdom@vattr:attribute(YSM))) -> lustre@vdom@vnode:element(YSM).
stop(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"stop"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 356).
?DOC("\n").
-spec image(list(lustre@vdom@vattr:attribute(YSQ))) -> lustre@vdom@vnode:element(YSQ).
image(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"image"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 361).
?DOC("\n").
-spec path(list(lustre@vdom@vattr:attribute(YSU))) -> lustre@vdom@vnode:element(YSU).
path(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"path"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 366).
?DOC("\n").
-spec text(list(lustre@vdom@vattr:attribute(YSY)), binary()) -> lustre@vdom@vnode:element(YSY).
text(Attrs, Content) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"text"/utf8>>,
        Attrs,
        [lustre@element:text(Content)]
    ).

-file("src/lustre/element/svg.gleam", 374).
?DOC("\n").
-spec use_(list(lustre@vdom@vattr:attribute(YTC))) -> lustre@vdom@vnode:element(YTC).
use_(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"use"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 381).
?DOC("\n").
-spec fe_distant_light(list(lustre@vdom@vattr:attribute(YTG))) -> lustre@vdom@vnode:element(YTG).
fe_distant_light(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feDistantLight"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 386).
?DOC("\n").
-spec fe_point_light(list(lustre@vdom@vattr:attribute(YTK))) -> lustre@vdom@vnode:element(YTK).
fe_point_light(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"fePointLight"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 391).
?DOC("\n").
-spec fe_spot_light(list(lustre@vdom@vattr:attribute(YTO))) -> lustre@vdom@vnode:element(YTO).
fe_spot_light(Attrs) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"feSpotLight"/utf8>>,
        Attrs,
        []
    ).

-file("src/lustre/element/svg.gleam", 398).
?DOC("\n").
-spec clip_path(
    list(lustre@vdom@vattr:attribute(YTS)),
    list(lustre@vdom@vnode:element(YTS))
) -> lustre@vdom@vnode:element(YTS).
clip_path(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"clipPath"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 406).
?DOC("\n").
-spec script(list(lustre@vdom@vattr:attribute(YTY)), binary()) -> lustre@vdom@vnode:element(YTY).
script(Attrs, Js) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"script"/utf8>>,
        Attrs,
        [lustre@element:text(Js)]
    ).

-file("src/lustre/element/svg.gleam", 411).
?DOC("\n").
-spec style(list(lustre@vdom@vattr:attribute(YUC)), binary()) -> lustre@vdom@vnode:element(YUC).
style(Attrs, Css) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"style"/utf8>>,
        Attrs,
        [lustre@element:text(Css)]
    ).

-file("src/lustre/element/svg.gleam", 418).
?DOC("\n").
-spec foreign_object(
    list(lustre@vdom@vattr:attribute(YUG)),
    list(lustre@vdom@vnode:element(YUG))
) -> lustre@vdom@vnode:element(YUG).
foreign_object(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"foreignObject"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 426).
?DOC("\n").
-spec text_path(
    list(lustre@vdom@vattr:attribute(YUM)),
    list(lustre@vdom@vnode:element(YUM))
) -> lustre@vdom@vnode:element(YUM).
text_path(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"textPath"/utf8>>,
        Attrs,
        Children
    ).

-file("src/lustre/element/svg.gleam", 434).
?DOC("\n").
-spec tspan(
    list(lustre@vdom@vattr:attribute(YUS)),
    list(lustre@vdom@vnode:element(YUS))
) -> lustre@vdom@vnode:element(YUS).
tspan(Attrs, Children) ->
    lustre@element:namespaced(
        <<"http://www.w3.org/2000/svg"/utf8>>,
        <<"tspan"/utf8>>,
        Attrs,
        Children
    ).
