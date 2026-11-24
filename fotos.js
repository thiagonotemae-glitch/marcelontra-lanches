// =============================================================
//  FOTOS DOS PRODUTOS
//  As fotos ficam na pasta "imagem" (na raiz do projeto).
//  O nome do arquivo é o nome do produto. Exemplo:
//    Produto "Batata Frita"  →  imagem/batata frita.jpg
//  Não importa maiúscula/minúscula, acento, hífen ou a extensão.
//  Se não achar foto, o site continua mostrando o emoji.
// =============================================================
const fs = require('fs');
const path = require('path');

const PASTA = path.join(__dirname, 'imagem');
const EXTENSOES = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.jfif'];

// "X-Burguer" → "x burguer"  |  "Nuggets (10 un.)" → "nuggets 10 un"
function normalizar(texto) {
  return String(texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')                     // troca símbolos por espaço
    .trim();
}

// Lê a pasta e monta uma lista { nome normalizado → arquivo }
function listarFotos() {
  if (!fs.existsSync(PASTA)) return [];
  return fs.readdirSync(PASTA)
    .filter((arquivo) => EXTENSOES.includes(path.extname(arquivo).toLowerCase()))
    .map((arquivo) => ({ chave: normalizar(path.parse(arquivo).name), arquivo }));
}

// Procura a foto de um produto:
// 1º nome igual ("batata frita" = "batata frita")
// 2º nome do arquivo é o começo do nome do produto ("nuggets" serve para "Nuggets (10 un.)")
function acharFoto(nomeProduto, fotos) {
  const nome = normalizar(nomeProduto);
  const igual = fotos.find((f) => f.chave === nome);
  if (igual) return igual.arquivo;

  const parecidas = fotos
    .filter((f) => f.chave && nome.startsWith(f.chave + ' '))
    .sort((a, b) => b.chave.length - a.chave.length); // a mais completa ganha
  return parecidas[0]?.arquivo || null;
}

// Coloca o campo "foto" (endereço da imagem ou null) em cada produto da lista
function comFotos(lista, campoNome = 'nome') {
  const fotos = listarFotos();
  for (const item of lista) {
    const arquivo = acharFoto(item[campoNome], fotos);
    item.foto = arquivo ? `/imagem/${encodeURIComponent(arquivo)}` : null;
  }
  return lista;
}

module.exports = { PASTA, comFotos };
