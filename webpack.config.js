// Merged on top of pcf-scripts' out-of-the-box config via webpack-merge.
// Arrays are appended, so these rules add to the OOB ts/js rules rather than
// replacing them. Monaco's ESM build imports CSS and the codicon TTF; PCF
// serves a single bundle.js, so both have to end up inside it.
module.exports = {
    module: {
        // Monaco 0.56 hardcodes `new Worker(new URL('x.worker.js', import.meta.url))`.
        // Webpack parses that statically and emits each worker as its own entry
        // and runtime -- which PCF's LimitChunkCountPlugin({maxChunks:1}) then
        // cannot merge, failing production builds with "RuntimeIdRuntimeModule
        // must be in a single runtime". Disabling the parser hook stops the extra
        // entries; workers are supplied at runtime via MonacoEnvironment instead.
        parser: {
            javascript: {
                worker: false
            }
        },
        rules: [
            {
                test: /\.css$/,
                use: ["style-loader", "css-loader"]
            },
            {
                // Inline as a data URI. asset/resource would emit a second file
                // that the PCF runtime would never serve.
                test: /\.ttf$/,
                type: "asset/inline"
            }
        ]
    }
};
