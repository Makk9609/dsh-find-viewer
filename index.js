/**
 * Host half of the find bar bundle.
 *
 * The whole feature lives in the browser: it renders into the document preview's
 * toolbar slot and reads files through the Client Remote. This row exists so the
 * Loader carries the package and the browser half is discovered from
 * `dsh.client` in package.json.
 */
export function apply() {}
