// Merged on top of pcf-scripts' out-of-the-box config via webpack-merge.
// Arrays are appended, so these rules add to the OOB ts/js rules rather than
// replacing them. Monaco's ESM build imports CSS and the codicon TTF; PCF
// serves a single bundle.js, so both have to end up inside it.
//
// The CSS half is pcf-scripts' own now. 1.14 had no CSS rule and this file
// carried a style-loader/css-loader pair; 1.51 ships
// `["style-loader", "css-loader", "sass-loader"]` for `.css`, and because
// arrays are appended a second rule here ran *after* it -- sass-loader was
// handed JavaScript and failed on every one of Monaco's stylesheets with
// `expected "{"`. Keep only what the OOB config lacks.
//
// `style-loader` stays a devDependency of this repository even so. pcf-scripts
// names its loaders as bare strings and webpack resolves them from the
// project root, not from pcf-scripts' own node_modules -- so a project that
// imports CSS from JavaScript (this one, through Monaco) has to hold a copy
// where the rule can find it. Siblings never notice because nothing in them
// imports a stylesheet.
module.exports = {
    module: {
        // Monaco 0.56 hardcodes `new Worker(new URL('x.worker.js', import.meta.url))`.
        // Webpack parses that statically and emits each worker as its own entry
        // and runtime -- which PCF's LimitChunkCountPlugin({maxChunks:1}) then
        // cannot merge, failing production builds with "RuntimeIdRuntimeModule
        // must be in a single runtime". Disabling the parser hook stops the extra
        // entries; the URL still lands in `out/` as a tiny stub nothing serves.
        parser: {
            javascript: {
                worker: false
            }
        },
        rules: [
            {
                // Inline as a data URI. asset/resource would emit a second file
                // that the PCF runtime would never serve.
                test: /\.ttf$/,
                type: "asset/inline"
            }
        ]
    }
};
