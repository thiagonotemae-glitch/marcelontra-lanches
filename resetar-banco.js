// Apaga o arquivo do banco. Na próxima vez que o servidor iniciar,
// as tabelas e o cardápio inicial são criados de novo.
const fs = require('fs');
const path = require('path');

const arquivo = path.join(__dirname, 'lanchonete.db');
if (fs.existsSync(arquivo)) {
  fs.unlinkSync(arquivo);
  console.log('Banco apagado. Rode "npm start" para criar de novo.');
} else {
  console.log('Não existe banco para apagar.');
}
