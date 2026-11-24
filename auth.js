// =============================================================
//  SENHAS E SESSÕES
//  A senha NUNCA é salva do jeito que o usuário digitou.
//  Salvamos um "hash" (embaralhamento que não dá para desfazer)
//  usando o módulo "crypto", que já vem no Node.js.
// =============================================================
const crypto = require('crypto');

// Transforma a senha em "sal:hash" para guardar no banco
function gerarHash(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

// Confere se a senha digitada bate com o hash salvo
function conferirSenha(senha, salvo) {
  const [sal, hash] = String(salvo).split(':');
  if (!sal || !hash) return false;
  const tentativa = crypto.scryptSync(senha, sal, 64);
  const original = Buffer.from(hash, 'hex');
  return original.length === tentativa.length && crypto.timingSafeEqual(original, tentativa);
}

// Gera um código aleatório para identificar quem está logado
function gerarToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Código de 6 números para confirmar o e-mail (ex.: 482913)
function gerarCodigo() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// O código também é guardado embaralhado no banco
function hashCodigo(codigo) {
  return crypto.createHash('sha256').update(String(codigo)).digest('hex');
}

module.exports = { gerarHash, conferirSenha, gerarToken, gerarCodigo, hashCodigo };
