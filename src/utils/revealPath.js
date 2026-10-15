/**
 * O caminho pedido pelo renderer pode ser revelado no Explorer?
 * Handler IPC não abre caminho arbitrário: só arquivo existente
 * dentro da pasta escaneada.
 * @param {*} target - Caminho vindo do renderer (não confiável)
 * @param {string|null} root - Pasta do último scan
 * @param {object} fs - módulo fs (injetável)
 * @param {object} path - módulo path (injetável)
 * @returns {boolean}
 */
function canReveal(target, root, fs, path) {
  if (typeof target !== "string" || !root || !path.isAbsolute(target)) return false;

  const rel = path.relative(path.resolve(root), path.resolve(target));
  const escapes = rel === ".." || rel.startsWith(".." + path.sep);
  if (!rel || escapes || path.isAbsolute(rel)) return false;

  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

module.exports = { canReveal };
