// =============================================================
//  ENVIO DE E-MAIL (código de confirmação do cadastro)
//  Usa a biblioteca "nodemailer" e uma conta do Gmail.
//  Os dados da conta ficam no arquivo ".env" (veja o README).
//
//  Se o .env não estiver preenchido, o código NÃO é enviado:
//  ele aparece no terminal do servidor (modo de teste).
// =============================================================
const nodemailer = require('nodemailer');

const USUARIO = process.env.EMAIL_USUARIO || '';
const SENHA_APP = (process.env.EMAIL_SENHA_APP || '').replace(/\s+/g, '');
const CONFIGURADO = Boolean(USUARIO && SENHA_APP);

const transporte = CONFIGURADO
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: USUARIO, pass: SENHA_APP } })
  : null;

// Textos de cada tipo de e-mail
const TEXTOS = {
  cadastro: {
    assunto: (c) => `${c} é o seu código da Marcelontra Lanches`,
    frase: 'Use o código abaixo para confirmar seu e-mail e ativar sua conta:',
    aviso: 'Se você não criou uma conta na Marcelontra Lanches, ignore este e-mail.',
  },
  senha: {
    assunto: (c) => `${c} é o código para trocar sua senha — Marcelontra Lanches`,
    frase: 'Recebemos um pedido para trocar a senha da sua conta. Use o código abaixo:',
    aviso: 'Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.',
  },
  email: {
    assunto: (c) => `${c} é o código para confirmar seu novo e-mail — Marcelontra Lanches`,
    frase: 'Você pediu para trocar o e-mail da sua conta para este endereço. Use o código abaixo para confirmar:',
    aviso: 'Se não foi você que pediu, ignore este e-mail: nada será alterado.',
  },
};
const NOME_TIPO = { cadastro: 'cadastro', senha: 'trocar senha', email: 'trocar e-mail' };

function htmlEmail(nome, codigo, tipo) {
  const t = TEXTOS[tipo];
  const primeiroNome = String(nome).split(' ')[0].replace(/[<>&"]/g, '');
  return `
  <div style="font-family:Arial,sans-serif;background:#fffaf0;padding:24px">
    <div style="max-width:460px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border-top:6px solid #ffc72c">
      <div style="background:#da291c;color:#fff;padding:20px 24px;font-size:22px;font-weight:bold">
        <span style="background:#ffc72c;color:#da291c;border-radius:8px;padding:2px 10px;margin-right:6px">M</span>
        Marcelontra <span style="color:#ffc72c">Lanches</span>
      </div>
      <div style="padding:24px;color:#27251f">
        <p style="font-size:18px;margin:0 0 8px">Olá, ${primeiroNome}! 🍔</p>
        <p style="margin:0 0 20px">${t.frase}</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:10px;text-align:center;background:#fff4cc;border-radius:12px;padding:16px;color:#da291c">
          ${codigo}
        </div>
        <p style="color:#6f6a5f;font-size:13px;margin:20px 0 0">
          O código vale por 10 minutos. ${t.aviso}
        </p>
      </div>
    </div>
  </div>`;
}

// Devolve "email" se mandou de verdade, ou "terminal" se só mostrou no terminal
// tipo: 'cadastro' (confirmar e-mail) ou 'senha' (esqueci minha senha)
async function enviarCodigo(para, nome, codigo, tipo = 'cadastro') {
  const t = TEXTOS[tipo];
  if (!CONFIGURADO) {
    console.log('\n┌──────────────────────────────────────────────┐');
    console.log('│  E-MAIL NÃO CONFIGURADO — MODO DE TESTE       │');
    console.log(`│  Código (${NOME_TIPO[tipo]}) para ${para}`);
    console.log(`│  >>>  ${codigo}  <<<`);
    console.log('└──────────────────────────────────────────────┘\n');
    return 'terminal';
  }

  await transporte.sendMail({
    from: `"Marcelontra Lanches" <${USUARIO}>`,
    to: para,
    subject: t.assunto(codigo),
    text: `Olá! ${t.frase} ${codigo} (vale por 10 minutos). ${t.aviso}`,
    html: htmlEmail(nome, codigo, tipo),
  });
  return 'email';
}

// Testa se o Gmail aceita o e-mail + senha de app (não manda nenhum e-mail)
async function testarConexao() {
  if (!CONFIGURADO) return;
  try {
    await transporte.verify();
    console.log(`E-mail: conexão com o Gmail OK ✅ — códigos serão enviados de ${USUARIO}`);
  } catch (erro) {
    console.log('E-mail: o Gmail RECUSOU o login ❌');
    console.log('  Confira no arquivo .env se o e-mail é o mesmo onde a senha de app foi criada');
    console.log('  e se a senha de 16 letras foi copiada certinho. Depois reinicie o servidor.');
    console.log(`  (detalhe: ${erro.code || ''} ${erro.message.split('\n')[0]})`);
  }
}

module.exports = { enviarCodigo, testarConexao, EMAIL_CONFIGURADO: CONFIGURADO };
