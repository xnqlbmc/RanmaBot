// ⚠️ Qualquer uso indevido ou ilegal é de total responsabilidade do usuário. Aproveite para turbinar seu bot com segurança e praticidade! 🚀\\

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { exec, execFile } = require('child_process');
const chalk = require("chalk");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const config = require("./settings/config.json");
const GroupManager = require("./database/groupManager");
const yts = require("yt-search");
const { GoogleGenAI } = require('@google/genai');

// ===========================
// 🤖 FUNÇÃO DE INTERAÇÃO COM IA (GEMINI)
// ===========================
async function generateAIResponse(prompt) {
    if (!ai) {
        throw new Error("API Key do Gemini não está configurada.");
    }
    
    // Configuração básica do modelo (ajuste conforme a necessidade)
    const systemInstruction = "Você é um bot de WhatsApp amigável e útil chamado ${config.NomeDoBot}. Suas respostas devem ser diretas e informais. Mantenha as respostas curtas, a menos que seja solicitado o contrário.";

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.8, // 0.8 é bom para criatividade, 0.2 para fatos
            }
        });

        // O texto de resposta está em response.text
        return response.text;
    } catch (error) {
        console.error("Erro ao chamar a API Gemini:", error);
        return "Desculpe, a IA está indisponível ou encontrou um erro. Tente novamente mais tarde.";
    }
}

// ===========================
// 🌍 CONFIGURAÇÃO GLOBAL
// ===========================
const GEMINI_API_KEY = config.GEMINI_API_KEY; 
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const globalConfig = {
  antilinkHard: false,
  welcomeEnabled: true
};

const botStart = Date.now(); 
const groupState = new Map();
const comandos2 = ["ping", "status", "antilinkhard", "antilinkgp", "ban", "welcome", "menu", "stats", "backup", "play", "play2", "playvid", "playvidhd", "downloadvid", "downloadmp3", "sticker", "s", "gemini"]; // lista oficial de comandos

// Inicializar gerenciador de grupos
const groupManager = new GroupManager();

// ===========================
// 📊 SISTEMA DE MONITORAMENTO
// ===========================
const monitoringData = {
  messagesReceived: 0,
  commandsExecuted: 0,
  groupsActive: new Set(),
  lastActivity: Date.now(),
  startTime: Date.now()
};

function logActivity(type, details = {}) {
  const timestamp = new Date().toLocaleString('pt-BR');
  const logEntry = {
    timestamp,
    type,
    details,
    uptime: Date.now() - botStart
  };
  
  // Log colorido no terminal
  switch (type) {
    case 'MESSAGE_RECEIVED':
      console.log(chalk.hex('#87CEEB').bold(`📨 [${timestamp}] Mensagem recebida`));
      if (details.isGroup) {
        console.log(chalk.hex('#87CEEB')(`   └─ Grupo: ${details.groupName || 'Desconhecido'}`));
      }
      console.log(chalk.hex('#87CEEB')(`   └─ Tipo: ${details.messageType || 'Texto'}`));
      break;
      
    case 'COMMAND_EXECUTED':
      console.log(chalk.hex('#98FB98').bold(`⚡ [${timestamp}] Comando executado: ${details.command}`));
      if (details.isGroup) {
        console.log(chalk.hex('#98FB98')(`   └─ Grupo: ${details.groupName || 'Desconhecido'}`));
      }
      break;
      
    case 'GROUP_DATA_SAVED':
      console.log(chalk.hex('#DDA0DD').bold(`💾 [${timestamp}] Dados do grupo salvos`));
      console.log(chalk.hex('#DDA0DD')(`   └─ Grupo: ${details.groupName}`));
      console.log(chalk.hex('#DDA0DD')(`   └─ Membros: ${details.memberCount}`));
      break;
      
    case 'ANTILINK_TRIGGERED':
      console.log(chalk.hex('#FF4500').bold(`🚫 [${timestamp}] Anti-link ativado`));
      console.log(chalk.hex('#FF4500')(`   └─ Grupo: ${details.groupName || 'Desconhecido'}`));
      console.log(chalk.hex('#FF4500')(`   └─ Ação: ${details.action}`));
      break;
      
    case 'USER_JOINED':
      console.log(chalk.hex('#FF69B4').bold(`👋 [${timestamp}] Novo membro`));
      console.log(chalk.hex('#FF69B4')(`   └─ Grupo: ${details.groupName}`));
      break;
      
    case 'CONFIG_CHANGED':
      console.log(chalk.hex('#40E0D0').bold(`⚙️  [${timestamp}] Configuração alterada`));
      console.log(chalk.hex('#40E0D0')(`   └─ ${details.setting}: ${details.value ? 'ON' : 'OFF'}`));
      break;
      
    case 'BACKUP_CREATED':
      console.log(chalk.hex('#4ECDC4').bold(`💾 [${timestamp}] Backup criado`));
      console.log(chalk.hex('#4ECDC4')(`   └─ Local: ${details.path}`));
      break;
      
    case 'STATS_REQUESTED':
      console.log(chalk.hex('#FFE66D').bold(`📊 [${timestamp}] Estatísticas solicitadas`));
      if (details.isGroup) {
        console.log(chalk.hex('#FFE66D')(`   └─ Grupo: ${details.groupName}`));
      }
      break;
  }
  
  // Atualizar estatísticas
  monitoringData.lastActivity = Date.now();
  if (type === 'MESSAGE_RECEIVED') monitoringData.messagesReceived++;
  if (type === 'COMMAND_EXECUTED') monitoringData.commandsExecuted++;
  if (details.isGroup && details.groupId) monitoringData.groupsActive.add(details.groupId);
}

/* ===========================
   ⛏️ FUNÇÕES AUXILIARES
   =========================== */
function getTime() {
  return new Date().toLocaleTimeString("pt-BR");
}

function getTipoMensagem(msg) {
  if (msg.message?.stickerMessage) return "Figurinha";
  if (msg.message?.imageMessage) return "Imagem";
  if (msg.message?.videoMessage) return "Vídeo";
  if (msg.message?.audioMessage) return "Áudio";
  if (msg.message?.documentMessage) return "Documento";
  return "Texto";
}

async function getPermissions(sock, groupJid, participant, BOT_JID) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const admins = metadata.participants
      .filter(p => p.admin !== null)
      .map(p => p.id);

    return {
      isAdmin: admins.includes(participant),
      isBotAdmin: admins.includes(BOT_JID), // <--- AGORA USA O JID/LID COMPLETO DO BOT
      isOwnerGroup: metadata.owner === participant,
      groupName: metadata.subject,
    };
  } catch {
    return { isAdmin: false, isBotAdmin: false, isOwnerGroup: false, groupName: "Grupo" };
  }
}

// ===========================
// 📊 SIMILARIDADE ENTRE STRINGS
// ===========================
function similaridade(str1, str2) {
  str1 = str1.toLowerCase();
  str2 = str2.toLowerCase();

  const match = [...str1].filter(char => str2.includes(char)).length;
  const score = (match * 2) / (str1.length + str2.length) * 100;
  return score;
}

/* ===========================
   🛡️ SISTEMA DE ANTI-LINK
   =========================== */
const linkRegex = /(https?:\/\/|wa\.me\/|chat\.whatsapp\.com\/|t\.me\/|discord\.gg\/)/i;

async function verificarMensagem(sock, from, msg, body, isGroup, BOT_PHONE) {
  if (!linkRegex.test(body || "")) return false;

  const gp = groupState.get(from) || { antilinkGp: false };
  const antilinkAtivo = globalConfig.antilinkHard || (isGroup && gp.antilinkGp);
  if (!antilinkAtivo) return false;

  const participant = msg.key.participant || msg.key.remoteJid;
  const perms = await getPermissions(sock, from, participant, BOT_PHONE);

  if (perms.isAdmin || perms.isOwnerGroup) return false;

  await sock.sendMessage(from, { 
    text: "🚫 *Link detectado!*\n\nLinks não são permitidos neste grupo." 
  });

  let action = 'warning_sent';
  if (perms.isBotAdmin && isGroup) {
    try {
      await sock.groupParticipantsUpdate(from, [participant], "remove");
      await sock.sendMessage(from, { text: "🔨 *Usuário removido* por enviar link." });
      action = 'user_removed';
    } catch (e) {
      action = 'removal_failed';
    }
  }
  
  logActivity('ANTILINK_TRIGGERED', {
    groupName: perms.groupName,
    groupId: from,
    action,
    isGroup
  });
  
  return true;
}

/* ===========================
   🎉 SISTEMA DE BOAS-VINDAS
   =========================== */
async function handleWelcome(sock, events) {
  if (!globalConfig.welcomeEnabled) return;
  
  if (events["group-participants"]?.update) {
    const update = events["group-participants"].update;
    const { action, participants, id } = update;
    
    if (action === "add") {
      const metadata = await sock.groupMetadata(id);
      
      for (const participant of participants) {
        await sock.sendMessage(id, { text: welcomeMsg, mentions: [participant] });
        logActivity('USER_JOINED', {
          groupName: metadata.subject,
          groupId: id,
          userId: participant
        });
      }
      
      // Salvar dados atualizados do grupo
      await groupManager.saveGroupData(sock, id, 'member_added');
    }
  }
}

/* ===========================
   🧭 SISTEMA DE COMANDOS
   =========================== */
async function handleCommand(sock, from, msg, command, args, ctx) {
  const { isGroup, BOT_PHONE } = ctx;
  
  // Log do comando executado
  const perms = isGroup ? await getPermissions(sock, from, msg.key.participant, BOT_PHONE) : {};
  logActivity('COMMAND_EXECUTED', {
    command,
    isGroup,
    groupName: perms.groupName,
    groupId: from
  });

  switch (command) {
case "ping": {
  const start = Date.now();
  await sock.sendMessage(from, { text: "⏳ Calculando latência..." }, { quoted: msg })
    .then(async () => {
      const end = Date.now();
      const latency = end - start;

      // Calcula uptime em horas, minutos e segundos
      const uptimeMs = Date.now() - botStart;
      const seconds = Math.floor((uptimeMs / 1000) % 60);
      const minutes = Math.floor((uptimeMs / (1000 * 60)) % 60);
      const hours = Math.floor((uptimeMs / (1000 * 60 * 60)) % 24);
      const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));

      const uptime = `${days}d ${hours}h ${minutes}m ${seconds}s`;

      await sock.sendMessage(from, {
        text: `🏓 *Pong!* Latência: *${latency}ms*\n⏱️ Uptime: *${uptime}*`,
        mentions: [msg.sender] 
      }, { quoted: msg });
    });
}
break;

case "play2": {
  if (args.length === 0) {
    return sock.sendMessage(from, { text: "❌ *Uso:* .play [nome da música/vídeo]" }, { quoted: msg });
  }

  const query = args.join(" ");
  await sock.sendMessage(from, { text: `🎶 Buscando no YouTube Music: *${query}*...` }, { quoted: msg });

  try {
    // 1. Buscar a URL do vídeo mais relevante usando yt-dlp 
    //    (O prefixo "ytsearch1:" garante que ele pegue o primeiro resultado)
    //    (O --extract-flat e -j é para apenas obter metadados, sem baixar)
    const ytDlpSearchArgs = [
      `ytsearch1:${query}`,
      '--dump-json', 
      '-f', 'bestaudio', // Foco em áudio
      '--no-warnings'
    ];

    const { stdout, stderr } = await new Promise((resolve, reject) => {
        execFile('yt-dlp', ytDlpSearchArgs, (error, stdout, stderr) => {
            if (error) {
                // Se yt-dlp falhar (erro de comando, não de formato), reject
                reject(new Error(stderr || error.message)); 
            } else {
                resolve({ stdout, stderr });
            }
        });
    });

    if (stdout.trim() === "") {
        return sock.sendMessage(from, { text: "❌ Nenhuma música encontrada no YouTube Music para essa busca." }, { quoted: msg });
    }

    const videoInfo = JSON.parse(stdout.trim());
    
    // O yt-dlp retorna a URL do vídeo diretamente
    const videoUrl = videoInfo.url;
    const videoTitle = videoInfo.title;
    
    // Verifica se a URL é válida (alguns resultados podem não ter URL de vídeo)
    if (!videoUrl || videoInfo.extractor_key !== 'Youtube') {
        return sock.sendMessage(from, { text: "❌ Resultado da busca não é um vídeo válido do YouTube." }, { quoted: msg });
    }
    
    const infoText = 
        `✅ *Música Encontrada (Music)*\n\n` +
        `• *Título:* ${videoTitle}\n` +
        `• *Link:* ${videoUrl}`;
    
    await sock.sendMessage(from, { text: infoText }, { quoted: msg });

    // 2. Download e conversão usando yt-dlp (o download continua igual, mas com a nova URL)
    const tempAudioPath = path.join(__dirname, `temp_audio_${Date.now()}.mp3`);

    const ytdlpArgs = [
      videoUrl,
      '--extract-audio', 
      '--audio-format', 'mp3', 
      '--output', tempAudioPath, 
      '--max-filesize', '50M', 
      '--no-warnings'
    ];

    execFile('yt-dlp', ytdlpArgs, async (err, stdout, stderr) => {
      // ... O código de download e envio de áudio permanece o mesmo ...
      // (Não precisa mudar nada aqui, pois você já corrigiu esta parte)
      
      if (err) {
        console.error(chalk.red(`❌ Erro ao executar yt-dlp (download): ${err.message}`));
        if (stderr) console.error(`Stderr: ${stderr}`);
        return sock.sendMessage(from, { text: "❌ Erro ao baixar ou converter o áudio com yt-dlp." }, { quoted: msg });
      }

      try {
          // ... (resto do bloco try do download/envio)
      } finally {
          // ... (bloco finally de limpeza)
      }
    });

  } catch (error) {
    console.error(chalk.red(`❌ Erro no comando 'play' (busca): ${error.message}`));
    // Adiciona log detalhado em caso de erro de JSON/yt-dlp search
    if (error.message.includes('yt-dlp')) {
        console.error("Dica: Verifique se o yt-dlp está no PATH e atualizado.");
    }
    return sock.sendMessage(from, { text: "❌ Ocorreu um erro geral ao processar sua solicitação de busca." }, { quoted: msg });
  }
}
break;

case "playvid": {
    if (args.length === 0) {
        return sock.sendMessage(from, { text: "❌ *Uso:* .playvid [nome do vídeo]" }, { quoted: msg });
    }

    const query = args.join(" ");
    
    // Declarações necessárias para o bloco finally
    let tempVideoPath = null;
    let tempThumbnailPath = null;
    let videoTitle = query; 

    try {
        await sock.sendMessage(from, { text: `🎶 Buscando: *${query}*...` }, { quoted: msg });

        // 1. Buscar o vídeo no YouTube com yt-search (mais estável)
        const searchResults = await yts(query);
        
        if (!searchResults.videos || searchResults.videos.length === 0) {
            return sock.sendMessage(from, { text: "❌ Nenhuma música/vídeo encontrado para essa busca." }, { quoted: msg });
        }

        const video = searchResults.videos[0];
        const videoUrl = video.url;
        videoTitle = video.title; 
        const thumbnailUrl = video.image; // URL da miniatura

        const infoText = 
            `✅ *Vídeo Encontrado*\n\n` +
            `• *Título:* ${videoTitle}\n` +
            `• *Duração:* ${video.timestamp || 'N/A'}\n` +
            `• *Link:* ${videoUrl}\n\n` +
            `⏳ Iniciando download otimizado...`;
        
        
        // 2. BAIXAR E ENVIAR A MINIATURA
        if (thumbnailUrl) {
            tempThumbnailPath = path.join(__dirname, `temp_thumb_${Date.now()}.jpg`);
            
            const thumbResponse = await axios.get(thumbnailUrl, {
                responseType: 'arraybuffer',
                timeout: 5000
            });

            fs.writeFileSync(tempThumbnailPath, thumbResponse.data);

            await sock.sendMessage(from, { 
                image: fs.readFileSync(tempThumbnailPath), 
                mimetype: "image/jpeg",
                caption: infoText 
            }, { quoted: msg });
            
        } else {
            await sock.sendMessage(from, { text: infoText }, { quoted: msg });
        }

        // 3. Download e conversão usando yt-dlp (AGORA COM PROMISE/AWAIT)
        tempVideoPath = path.join(__dirname, `temp_video_${Date.now()}.mp4`); 

const ytdlpArgs = [
  videoUrl,
  '-f', 'bv*+ba/b', // Best Video + Best Audio
  '--recode-video', 'mp4', // FORÇA o yt-dlp a usar o ffmpeg para garantir que o container seja MP4
  '--max-filesize', '50M', // Limite o tamanho do arquivo
  // --------------------------------------------------------------------
  // ⚡ FILTROS DE OTIMIZAÇÃO FFmpeg:
  // 1. Aplica o filtro de escala (reduz para 80% da altura original)
  // 2. Define um bitrate máximo de 1500k para acelerar a conversão
  '--postprocessor-args', 'ffmpeg_i:-vf scale=-2:ih*0.6',
  // --------------------------------------------------------------------
  '--output', tempVideoPath, // Define o nome do arquivo de saída
  '--no-warnings'
];

        // 💡 EXECUÇÃO DO YTDLP DENTRO DE UMA PROMISE PARA USAR AWAIT
        await new Promise((resolve, reject) => {
            execFile('yt-dlp', ytdlpArgs, (err, stdout, stderr) => {
                if (err) {
                    console.error(chalk.red(`Stderr do yt-dlp: ${stderr}`));
                    reject(new Error(`Erro ao baixar/converter o vídeo: ${err.message}`));
                } else {
                    resolve();
                }
            });
        });

        // 4. ENVIO DO VÍDEO
        if (!fs.existsSync(tempVideoPath)) {
            throw new Error("O arquivo de vídeo não foi criado. Falha na conversão FFmpeg.");
        }
        
        await sock.sendMessage(from, { 
            video: fs.readFileSync(tempVideoPath),
            mimetype: "video/mp4",
            caption: `🎥 ${videoTitle} (Download Concluído)`
        }, { quoted: msg });

    } catch (error) {
        // 5. CAPTURA DE ERRO CENTRALIZADA
        console.error(chalk.red(`❌ Erro no comando 'playvid': ${error.message}`));
        return sock.sendMessage(from, { text: `❌ Ocorreu um erro ao processar o vídeo: ${error.message.substring(0, 150)}...` }, { quoted: msg });
    } finally {
        // 6. LIMPEZA GARANTIDA (Agora fora do try)
        await new Promise(resolve => setTimeout(resolve, 500)); 
        if (tempVideoPath && fs.existsSync(tempVideoPath)) {
            fs.unlinkSync(tempVideoPath);
        }
        if (tempThumbnailPath && fs.existsSync(tempThumbnailPath)) {
            fs.unlinkSync(tempThumbnailPath);
        }
    }
}
break;

case "playvidhd": {
  if (args.length === 0) {
    return sock.sendMessage(from, { text: "❌ *Uso:* .play [nome da música/vídeo]" }, { quoted: msg });
  }

  const query = args.join(" ");
  await sock.sendMessage(from, { text: `🎶 Buscando: *${query}*...` }, { quoted: msg });

try {
  // 1. Buscar o vídeo no YouTube com yt-search (mais estável)
  const searchResults = await yts(query);
  
  if (!searchResults.videos || searchResults.videos.length === 0) {
    return sock.sendMessage(from, { text: "❌ Nenhuma música encontrada para essa busca." }, { quoted: msg });
  }

  // Pega o primeiro resultado que é um vídeo
  const video = searchResults.videos[0]; 
  
  const videoInfo = JSON.parse(stdout.trim());
  const videoUrl = video.url;
  const videoTitle = video.title;
  const thumbnailUrl = videoInfo.thumbnail;
  
  const infoText = 
      `✅ *Música Encontrada*\n\n` +
      `• *Título:* ${videoTitle}\n` +
      `• *Duração:* ${video.timestamp || 'N/A'}\n` +
      `• *Link:* ${videoUrl}`;
  
  await sock.sendMessage(from, { text: infoText }, { quoted: msg });

// ===========================================
      // 2. BAIXAR E ENVIAR A MINIATURA
      // ===========================================
      if (thumbnailUrl) {
          await sock.sendMessage(from, { text: `Baixando a miniatura...` }, { quoted: msg });
          
          const thumbResponse = await axios.get(thumbnailUrl, {
              responseType: 'arraybuffer'
          });

          fs.writeFileSync(tempThumbnailPath, thumbResponse.data);

          await sock.sendMessage(from, { 
              image: fs.readFileSync(tempThumbnailPath), 
              mimetype: "image/jpeg",
              caption: infoText // Usa o texto de informação como legenda da miniatura
          }, { quoted: msg });
          
      } else {
          // Se não encontrou a miniatura, envia só o texto
          await sock.sendMessage(from, { text: infoText }, { quoted: msg });
      }

  // 2. Download e conversão usando yt-dlp (o código de execFile abaixo permanece o mesmo)
const tempVideoPath = path.join(__dirname, `temp_video_${Date.now()}.mp4`); 

const ytdlpArgs = [
  videoUrl,
  '-f', 'bv*+ba/b', // O formato que você queria: Best Video + Best Audio
  '--recode-video', 'mp4', // FORÇA o yt-dlp a usar o ffmpeg para garantir que o container seja MP4
  '--output', tempVideoPath, // Define o nome do arquivo de saída
  '--max-filesize', '50M', // Limite o tamanho do arquivo
  '--no-warnings'
];

execFile('yt-dlp', ytdlpArgs, async (err, stdout, stderr) => {
  if (err) {
    console.error(chalk.red(`❌ Erro ao executar yt-dlp (download de vídeo): ${err.message}`));
    if (stderr) console.error(`Stderr: ${stderr}`);
    // Limpa o arquivo, mesmo que a falha tenha sido na recodificação/mesclagem
    if (fs.existsSync(tempVideoPath)) {
        fs.unlinkSync(tempVideoPath);
    }
    return sock.sendMessage(from, { text: "❌ Erro ao baixar ou converter o vídeo. Verifique se o ffmpeg está instalado corretamente." }, { quoted: msg });
  }

  try {
    // 💡 VERIFICAÇÃO DE ARQUIVO
    if (!fs.existsSync(tempVideoPath)) { 
         return sock.sendMessage(from, { text: "❌ O arquivo de vídeo não foi criado. Verifique o log." }, { quoted: msg });
    }
    
    // 💡 ENVIO DE VÍDEO
    await sock.sendMessage(from, { 
      video: fs.readFileSync(tempVideoPath), // Usa a propriedade 'video'
      mimetype: "video/mp4", 
    }, { quoted: msg });
    
  } catch (e) {
    console.error("Erro ao enviar o vídeo:", e);
    await sock.sendMessage(from, { text: "❌ Falha ao enviar o vídeo." }, { quoted: msg });
  } finally {
    // 💡 LIMPEZA DO ARQUIVO
    if (fs.existsSync(tempVideoPath)) {
      fs.unlinkSync(tempVideoPath);
    }
  }
});

  } catch (error) {
    console.error(chalk.red(`❌ Erro no comando 'play' (busca ou inicialização): ${error.message}`));
    return sock.sendMessage(from, { text: "❌ Ocorreu um erro geral ao processar sua solicitação." }, { quoted: msg });
  }
}
break;

case "downloadmp3": {
    if (args.length === 0) {
        return sock.sendMessage(from, { text: `❌ *Uso:* ${config.prefix}downloadmp3 https://www.youtube.com/?hl=es-419` }, { quoted: msg });
    }

    const videoUrl = args[0];
    
    // Validação simples de URL
    if (!videoUrl || !videoUrl.includes('http')) {
        return sock.sendMessage(from, { text: "❌ Por favor, forneça uma URL válida (começando com http/https)." }, { quoted: msg });
    }

    // 💡 Declaração no escopo correto (Caminho para o áudio)
    const tempAudioPath = path.join(__dirname, `temp_audio_${Date.now()}.mp3`); 
    
    await sock.sendMessage(from, { text: `⏳ *Download iniciado* (URL direta).\nExtraindo e convertendo para MP3...` }, { quoted: msg });

    try {
        // 1. Download e EXTRAÇÃO DE ÁUDIO (Recodificação para MP3)
        const ytdlpDownloadArgs = [
          videoUrl,
          '--extract-audio', 
          '--audio-format', 'mp3', // Força a conversão para MP3 (usando FFmpeg)
          '--output', tempAudioPath, // Caminho de saída
          '--max-filesize', '50M', // Limite de tamanho (Para MP3, é muito generoso)
          '--no-warnings'
        ];

        // Executa o download/conversão
        await new Promise((resolve, reject) => {
            execFile('yt-dlp', ytdlpDownloadArgs, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(`Erro ao baixar: ${stderr || err.message}`));
                } else {
                    resolve();
                }
            });
        });

        // 2. Envio do Áudio
        if (!fs.existsSync(tempAudioPath)) { 
            throw new Error("O arquivo de áudio não foi criado após a conversão.");
        }
        
        await sock.sendMessage(from, { 
            audio: fs.readFileSync(tempAudioPath), 
            mimetype: "audio/mp4", // O WhatsApp usa o container MP4 para áudio MP3/AAC
            ptt: false // Envia como música (não como áudio de voz)
        }, { quoted: msg });
        
    } catch (error) {
        console.error(chalk.red(`❌ Erro no comando 'downloadmp3': ${error.message}`));
        await sock.sendMessage(from, { text: `❌ Ocorreu um erro ao processar o download. Verifique se o link é válido.` }, { quoted: msg });
    } finally {
        // 3. Limpeza
        if (fs.existsSync(tempAudioPath)) {
            fs.unlinkSync(tempAudioPath);
        }
    }
}
break;

case "downloadvid": {
    if (args.length === 0) {
        return sock.sendMessage(from, { text: `❌ *Uso:* ${config.prefix}downloadvid https://www.youtube.com/?hl=es-419` }, { quoted: msg });
    }

    const videoUrl = args[0];
    
    // Validação simples de URL
    if (!videoUrl || !videoUrl.includes('http')) {
        return sock.sendMessage(from, { text: "❌ Por favor, forneça uma URL válida (começando com http/https)." }, { quoted: msg });
    }

    // 💡 Declaração no escopo correto
    const tempVideoPath = path.join(__dirname, `temp_video_${Date.now()}.mp4`); 
    
    await sock.sendMessage(from, { text: `⏳ *Download iniciado* (URL direta).\nOtimizando e convertendo para MP4 (60% da resolução)...` }, { quoted: msg });

    try {
        // 1. Download e OTIMIZAÇÃO (Recodificação para MP4 + Redução de Qualidade)
const ytdlpDownloadArgs = [
  videoUrl,
  '-f', 'bv*+ba/b', // Baixa Best Video e Best Audio separados
  '--recode-video', 'mp4', // Mescla e recodifica para o MP4 (usando FFmpeg)
  '--cookies', 'C:\\Users\\xnqlb\\Downloads\\cookies.txt',
  '--output', tempVideoPath, // Caminho de saída
  '--max-filesize', '50M', 
  
  // ⚡ FILTROS DE OTIMIZAÇÃO: Garante o codec, bitrate e escala
  // Adicionamos -c:v libx264 para forçar o codec H.264
  '--postprocessor-args', 'ffmpeg:-c:v libx264 -b:v 1500k -vf scale=-2:ih*0.6', 
  
  '--no-warnings'
];

        // Executa o download/conversão
        await new Promise((resolve, reject) => {
            execFile('yt-dlp', ytdlpDownloadArgs, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(`Erro ao baixar: ${stderr || err.message}`));
                } else {
                    resolve();
                }
            });
        });

        // 2. Envio do Vídeo
        if (!fs.existsSync(tempVideoPath)) { 
            throw new Error("O arquivo de vídeo não foi criado após a conversão.");
        }
        
        await sock.sendMessage(from, { 
            video: fs.readFileSync(tempVideoPath), 
            mimetype: "video/mp4",
            caption: `📹 *Download concluído!*\n\nURL: ${videoUrl}\n\nOtimizado para envio rápido.`
        }, { quoted: msg });
        
    } catch (error) {
        console.error(chalk.red(`❌ Erro no comando 'downloadvid': ${error.message}`));
        await sock.sendMessage(from, { text: `❌ Ocorreu um erro ao processar o download. Tente novamente ou verifique se o link é público.` }, { quoted: msg });
    } finally {
        // 3. Limpeza
        if (fs.existsSync(tempVideoPath)) {
            fs.unlinkSync(tempVideoPath);
        }
    }
}
break;

case "play": {
    if (args.length === 0) {
        return sock.sendMessage(from, { text: "❌ *Uso:* .play [nome da música/vídeo]" }, { quoted: msg });
    }

    const query = args.join(" ");
    
    // Declarações necessárias para o bloco finally
    let tempAudioPath = null;
    let tempThumbnailPath = null; // Usado para a miniatura
    let videoTitle = query; 

    try {
        await sock.sendMessage(from, { text: `🎶 Buscando: *${query}*...` }, { quoted: msg });

        // 1. Buscar o vídeo no YouTube com yt-search (mais estável)
        const searchResults = await yts(query);
        
        if (!searchResults.videos || searchResults.videos.length === 0) {
            return sock.sendMessage(from, { text: "❌ Nenhuma música encontrada para essa busca." }, { quoted: msg });
        }

        const video = searchResults.videos[0];
        const videoUrl = video.url;
        videoTitle = video.title;
        const thumbnailUrl = video.image; // URL da miniatura

        const infoText = 
            `✅ *Música Encontrada*\n\n` +
            `• *Título:* ${videoTitle}\n` +
            `• *Duração:* ${video.timestamp || 'N/A'}\n` +
            `• *Link:* ${videoUrl}\n\n` +
            `🎧 Iniciando download do áudio...`;
        
        
        // 2. BAIXAR E ENVIAR A MINIATURA (USANDO LEGENDAS)
        if (thumbnailUrl) {
            tempThumbnailPath = path.join(__dirname, `temp_thumb_${Date.now()}.jpg`);
            
            // Download da miniatura
            const thumbResponse = await axios.get(thumbnailUrl, {
                responseType: 'arraybuffer',
                timeout: 5000
            });

            fs.writeFileSync(tempThumbnailPath, thumbResponse.data);

            // Envia a miniatura como preview, usando o infoText como legenda
            await sock.sendMessage(from, { 
                image: fs.readFileSync(tempThumbnailPath), 
                mimetype: "image/jpeg",
                caption: infoText 
            }, { quoted: msg });
            
        } else {
            await sock.sendMessage(from, { text: infoText }, { quoted: msg });
        }


        // 3. Download e conversão para MP3 usando yt-dlp (COM PROMISE/AWAIT)
        tempAudioPath = path.join(__dirname, `temp_audio_${Date.now()}.mp3`);

        const ytdlpArgs = [
            videoUrl,
            '--extract-audio',
            '--audio-format', 'mp3',
            '--output', tempAudioPath,
            '--max-filesize', '50M', 
            '--no-warnings'
        ];

        // 💡 EXECUÇÃO DO YTDLP DENTRO DE UMA PROMISE PARA USAR AWAIT
        await new Promise((resolve, reject) => {
            execFile('yt-dlp', ytdlpArgs, (err, stdout, stderr) => {
                if (err) {
                    console.error(chalk.red(`Stderr do yt-dlp (áudio): ${stderr}`));
                    reject(new Error(`Erro ao baixar/converter o áudio: ${err.message}`));
                } else {
                    resolve();
                }
            });
        });

        // 4. ENVIO DO ÁUDIO
        if (!fs.existsSync(tempAudioPath)) {
            throw new Error("O arquivo de áudio não foi criado. Verifique o log.");
        }
        
        await sock.sendMessage(from, { 
            audio: fs.readFileSync(tempAudioPath),
            mimetype: "audio/mp4", // O Baileys geralmente aceita mp3 com este mimetype
            caption: `🎶 ${videoTitle} (Download Concluído)`
        }, { quoted: msg });

    } catch (error) {
        // 5. CAPTURA DE ERRO CENTRALIZADA
        console.error(chalk.red(`❌ Erro no comando 'play': ${error.message}`));
        return sock.sendMessage(from, { text: `❌ Ocorreu um erro ao processar o áudio: ${error.message.substring(0, 150)}...` }, { quoted: msg });
    } finally {
        // 6. LIMPEZA GARANTIDA de ÁUDIO e MINIATURA
        await new Promise(resolve => setTimeout(resolve, 500)); 
        if (tempAudioPath && fs.existsSync(tempAudioPath)) {
            fs.unlinkSync(tempAudioPath);
        }
        if (tempThumbnailPath && fs.existsSync(tempThumbnailPath)) {
            fs.unlinkSync(tempThumbnailPath);
        }
    }
}
break;

case "gemini": { 
    if (!ai) {
        return sock.sendMessage(from, { text: "❌ O assistente de IA não está configurado. Fale com o desenvolvedor." }, { quoted: msg });
    }
    
    const prompt = args.join(" ");
    
    if (!prompt) {
        return sock.sendMessage(from, { text: `❌ *Uso:* ${config.prefix}gemini [sua pergunta]` }, { quoted: msg });
    }

    // Opcional: Envia uma mensagem de "digitando..."
    await sock.sendPresenceUpdate('composing', from); 
    
    try {
        const responseText = await generateAIResponse(prompt);
        
        await sock.sendMessage(from, { 
            text: `*🤖:* ${responseText}` 
        }, { quoted: msg });

    } catch (error) {
        console.error(`Erro no comando 'gemini': ${error.message}`);
        await sock.sendMessage(from, { text: "❌ Ocorreu um erro ao processar sua pergunta." }, { quoted: msg });
    } finally {
        // Volta ao status de online/disponível
        await sock.sendPresenceUpdate('available', from); 
    }
}
break;

case 'sticker':
case 's': {
    // 1. IDENTIFICAR A MENSAGEM DE MÍDIA CITADA/ATUAL (Lógica do autoSticker)
    
    // Tenta obter o objeto de mensagem citada (quotedMessage) ou a mensagem atual (msg.message).
    const isQuoted = msg.message?.extendedTextMessage?.contextInfo;
    const mediaMsg = isQuoted ? isQuoted.quotedMessage : msg.message;

    // Tenta buscar a mídia em todos os formatos (Imagem/Vídeo normal, ViewOnce v2, ViewOnce)
    const mediaImage = 
        mediaMsg?.imageMessage || 
        mediaMsg?.viewOnceMessageV2?.message?.imageMessage || 
        mediaMsg?.viewOnceMessage?.message?.imageMessage;
    
    const mediaVideo = 
        mediaMsg?.videoMessage || 
        mediaMsg?.viewOnceMessageV2?.message?.videoMessage || 
        mediaMsg?.viewOnceMessage?.message?.videoMessage;
    
    const mediaRef = mediaImage || mediaVideo;

    if (!mediaRef) {
        return sock.sendMessage(from, { text: "❌ Responda a uma imagem ou vídeo (máx. 9.9s) com o comando *sticker* ou *s*." }, { quoted: msg });
    }

    const isVideo = !!mediaVideo;
    const duration = mediaVideo?.seconds || 0;

    if (isVideo && duration > 9.9) {
        return sock.sendMessage(from, { text: "⚠️ O vídeo é muito longo! Envie um com até *9.9 segundos*." }, { quoted: msg });
    }

    // 2. CONFIGURAÇÃO DE DOWNLOAD (Mantendo o código original)
    const tempId = Date.now();
    const inputPath = path.join(__dirname, `temp_${tempId}.${isVideo ? 'mp4' : 'jpg'}`);
    const outputPath = path.join(__dirname, `temp_${tempId}.webp`);

    // 3. BAIXA A MÍDIA (CORREÇÃO DA CHAVE: Usa 'msg' se for citação)
    // Se a mídia estiver citada, passamos o objeto 'msg' (que contém o contexto da citação).
    // Se a mídia estiver na própria mensagem do comando, passamos o objeto 'mediaMsg'.
    const messageForDownload = isQuoted ? msg : mediaMsg; 

    // O downloadMediaMessage precisa da referência completa da mensagem.
    // Usamos 'msg' se for citação (pois 'msg' carrega a chave), ou a 'mediaMsg' se for o caso de viewOnce.
    // NOTA: Em muitas versões do Baileys, passar 'msg' é o suficiente para downloads, mas 'messageForDownload' é mais seguro.
const buffer = await downloadMediaMessage(
  msg, // Use o objeto principal da mensagem, que contém a chave (key) e o contexto (contextInfo).
  'buffer',
  {}, 
  { logger: console }
);
    fs.writeFileSync(inputPath, buffer);

    // 4. CONVERSÃO E ENVIO (Lógica original do FFmpeg)
    const ffmpegCmd = isVideo
        ? `ffmpeg -i "${inputPath}" -vf "scale=512:512,fps=15,setsar=1" -loop 0 -an -vsync 0 -lossless 1 -preset picture -compression_level 6 -qscale 75 "${outputPath}"`
        : `ffmpeg -i "${inputPath}" -vf "scale=512:512" -vframes 1 "${outputPath}"`;

    exec(ffmpegCmd, async (err) => {
        try {
            // Limpeza do input é feita ANTES da verificação de erro do FFmpeg
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); 

            if (err) {
                console.error(err);
                return sock.sendMessage(from, { text: "❌ Erro ao converter a mídia para sticker." }, { quoted: msg });
            }

            const stickerBuffer = fs.readFileSync(outputPath);
            await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
        } catch (e) {
            console.error(e);
            await sock.sendMessage(from, { text: "❌ Falha ao enviar o sticker." }, { quoted: msg });
        } finally {
            // Limpeza final garantida do output
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
        }
    });
}
break;

case "add": {
    if (!isGroup) {
        return sock.sendMessage(from, { text: "❌ Este comando só pode ser usado em grupos." }, { quoted: msg });
    }

    // 1. Obter metadados e IDs dos Administradores
    const metadata = await sock.groupMetadata(from);
    
    // Lista de todos os participantes que têm status de administrador (incluindo o bot, se for admin)
    const groupAdmins = metadata.participants
        .filter(p => p.admin !== null) // Filtra apenas admins
        .map(p => p.id); // Pega o ID (LID ou PN JID)
    
    // ===============================================
    // 💡 NOVA LÓGICA DE NORMALIZAÇÃO
    // ===============================================
    
    // Funções auxiliares para normalizar JID/LID para apenas o prefixo numérico/LID
    const normalizeId = (jid) => jid.split('@')[0].replace(/:[0-9]{2}/g, '');
    
    const groupAdminsNormalized = groupAdmins.map(normalizeId);
    
    // 2. Normalizar ID do Bot
    // sock.user.id pode vir com ":c" ou ":s" no final (ex: 5511...:c@s.whatsapp.net)
    const botIdRaw = sock.user.id;
    const botIdNormalized = normalizeId(botIdRaw); 

    // 3. Normalizar ID do Remetente (quem usou o comando)
    const senderIdRaw = msg.key.participant || msg.key.remoteJid;
    const senderIdNormalized = normalizeId(senderIdRaw);
    
    // ===============================================
    

    // 5. VERIFICAÇÃO DO USUÁRIO (Se quem usou o comando está na lista de admins)
    if (!groupAdminsNormalized.includes(senderIdNormalized)) {
        return sock.sendMessage(from, { text: "❌ Este comando é restrito a administradores do grupo." }, { quoted: msg });
    }

    // 6. O RESTO DO CÓDIGO (Obter e validar o número)
    if (args.length === 0) {
        return sock.sendMessage(from, { text: `❌ *Uso:* ${config.prefix}add [número] (ex: 5511987654321)` }, { quoted: msg });
    }

    let number = args[0].replace(/[^0-9]/g, ''); // Remove caracteres não numéricos

    if (number.length < 10) {
        return sock.sendMessage(from, { text: "❌ Número inválido. Por favor, inclua o código do país e DDD (ex: 5511...)." }, { quoted: msg });
    }

    // Formata o número para JID (PhoneNumber JID)
    const newMemberJid = number.includes('@s.whatsapp.net') ? number : number + '@s.whatsapp.net';

    try {
        await sock.sendMessage(from, { text: `⏳ Tentando adicionar ${number} ao grupo...` }, { quoted: msg });

        // A função groupParticipantsUpdate do Baileys ainda usa o formato JID (PN) como entrada.
        const response = await sock.groupParticipantsUpdate(
            from,
            [newMemberJid],
            'add' // Ação de adicionar
        );
        
        // ... (resto da lógica de sucesso e falha) ...

        const participantInfo = response[0];

        if (participantInfo && participantInfo.status === '200') {
            await sock.sendMessage(from, { text: `✅ O usuário ${number} foi adicionado com sucesso.` }, { quoted: msg });
        } else if (participantInfo && participantInfo.status === '408') {
            await sock.sendMessage(from, { text: `⚠️ Não foi possível adicionar o usuário ${number}. Ele(a) precisa aceitar o convite manual.` }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { text: `❌ Falha ao adicionar o usuário ${number}. O usuário pode ter saído recentemente ou o número está incorreto.` }, { quoted: msg });
        }

    } catch (error) {
        // ... (tratamento de erro) ...
        console.error(chalk.red(`❌ Erro no comando 'add': ${error.message}`));
        await sock.sendMessage(from, { text: `❌ Ocorreu um erro no servidor ao tentar adicionar o usuário.` }, { quoted: msg });
    }
}
break;

case "restart": {
    // Salvar todos os dados antes de reiniciar
    console.log(chalk.yellow('🔄 Salvando dados antes do reinício...'));
    
    // Salvar buffers de mensagens
    for (const groupId of groupManager.messageBuffer.keys()) {
      groupManager.flushMessageBuffer(groupId);
    }
    
    // Criar backup
    groupManager.createBackup();
    
    // Informa ao usuário que o bot vai reiniciar
    await sock.sendMessage(from, { 
        text: "♻️ Reiniciando o bot...\n💾 Dados salvos com segurança!", 
        mentions: [msg.sender] 
    }, { quoted: msg });

    // Aguarda 3 segundos antes de reiniciar
    setTimeout(() => {
        process.exit(0);
    }, 3000);
}
break;

    case "status": {
      const gp = groupState.get(from) || { antilinkGp: false };
      const uptimeMs = Date.now() - monitoringData.startTime;
      const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
      const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
      const generalStats = groupManager.getGeneralStats();
      
      const statusText = 
        `🤖 *STATUS DO ${config.NomeDoBot}*\n\n` +
        `• 📛 Prefixo: ${config.prefix}\n` +
        `• 👑 Dono: ${config.NickDono} (${config.numerodono})\n` +
        `• 🛡️ Anti-link Global: ${globalConfig.antilinkHard ? "✅ ON" : "❌ OFF"}\n` +
        `• 🎉 Boas-vindas: ${globalConfig.welcomeEnabled ? "✅ ON" : "❌ OFF"}\n` +
        `• ⏱️ Uptime: ${hours}h ${minutes}m\n` +
        `• 📨 Mensagens: ${monitoringData.messagesReceived}\n` +
        `• ⚡ Comandos: ${monitoringData.commandsExecuted}\n` +
        `• 👥 Grupos ativos: ${monitoringData.groupsActive.size}\n` +
        `• 💾 Grupos salvos: ${generalStats.totalGroups}\n` +
        `• 👤 Total membros: ${generalStats.totalMembers}\n` +
        (isGroup ? `• 🛡️ Anti-link Grupo: ${gp.antilinkGp ? "✅ ON" : "❌ OFF"}` : "");
      return sock.sendMessage(from, { text: statusText });
    }

    case "stats": {
      if (!isGroup) return sock.sendMessage(from, { text: "❌ Só funciona em grupos." });
      
      logActivity('STATS_REQUESTED', {
        isGroup,
        groupName: perms.groupName,
        groupId: from
      });
      
      const groupData = groupManager.getGroupData(from);
      if (!groupData) {
        return sock.sendMessage(from, { text: "❌ Dados do grupo não encontrados. Aguarde a próxima atualização." });
      }
      
      const statsText = 
        `📊 *ESTATÍSTICAS DO GRUPO*\n\n` +
        `• 📝 Nome: ${groupData.name}\n` +
        `• 👥 Membros: ${groupData.memberCount}\n` +
        `• 👑 Admins: ${groupData.adminCount}\n` +
        `• 📨 Mensagens: ${groupData.stats.totalMessages}\n` +
        `• 🔥 Membros ativos (24h): ${groupData.stats.activeMembers}\n` +
        `• 📅 Última atualização: ${new Date(groupData.lastUpdate).toLocaleString('pt-BR')}\n` +
        `• ⚙️ Configurações:\n` +
        `  └─ Apenas admins: ${groupData.settings.announce ? "✅" : "❌"}\n` +
        `  └─ Editar info: ${groupData.settings.restrict ? "Apenas admins" : "Todos"}`;
      
      return sock.sendMessage(from, { text: statsText });
    }

    case "backup": {
      const perms = await getPermissions(sock, from, msg.key.participant, BOT_PHONE);
      if (!perms.isAdmin && !perms.isOwnerGroup) {
        return sock.sendMessage(from, { text: "❌ Apenas administradores podem criar backups." });
      }
      
      await sock.sendMessage(from, { text: "💾 Criando backup dos dados..." });
      
      const backupPath = groupManager.createBackup();
      logActivity('BACKUP_CREATED', {
        path: backupPath,
        groupId: from,
        groupName: perms.groupName
      });
      
      return sock.sendMessage(from, { 
        text: `✅ *Backup criado com sucesso!*\n\n📁 Local: ${path.basename(backupPath)}\n⏰ Data: ${new Date().toLocaleString('pt-BR')}` 
      });
    }

    case "antilinkhard": {
      if (!isGroup) return sock.sendMessage(from, { text: "❌ Só funciona em grupos." });

      const perms = await getPermissions(sock, from, msg.key.participant, BOT_PHONE);
      if (!perms.isAdmin && !perms.isOwnerGroup) {
        return sock.sendMessage(from, { text: "❌ Apenas administradores podem usar." });
      }

      globalConfig.antilinkHard = !globalConfig.antilinkHard;
      logActivity('CONFIG_CHANGED', {
        setting: 'Anti-link Global',
        value: globalConfig.antilinkHard,
        groupId: from,
        groupName: perms.groupName
      });
      
      return sock.sendMessage(from, { text: `🛡️ Anti-link Global ${globalConfig.antilinkHard ? "✅ ATIVADO" : "❌ DESATIVADO"}` });
    }

    case "antilinkgp": {
      if (!isGroup) return sock.sendMessage(from, { text: "❌ Só funciona em grupos." });

      const perms = await getPermissions(sock, from, msg.key.participant, BOT_PHONE);
      if (!perms.isAdmin && !perms.isOwnerGroup) {
        return sock.sendMessage(from, { text: "❌ Apenas administradores podem usar." });
      }

      const gp = groupState.get(from) || { antilinkGp: false };
      gp.antilinkGp = !gp.antilinkGp;
      groupState.set(from, gp);
      
      logActivity('CONFIG_CHANGED', {
        setting: 'Anti-link Grupo',
        value: gp.antilinkGp,
        groupId: from,
        groupName: perms.groupName
      });
      
      // Salvar configuração do grupo
      await groupManager.saveGroupData(sock, from, 'settings_changed');
      
      return sock.sendMessage(from, { text: `🛡️ Anti-link do Grupo ${gp.antilinkGp ? "✅ ATIVADO" : "❌ DESATIVADO"}` });
    }

    case "ban": {
      if (!isGroup) return sock.sendMessage(from, { text: "❌ Só funciona em grupos." });

      const perms = await getPermissions(sock, from, msg.key.participant, BOT_JID); // Use BOT_JID
      if (!perms.isAdmin && !perms.isOwnerGroup) {
        return sock.sendMessage(from, { text: "❌ Apenas administradores podem banir." });
      }
      if (!perms.isBotAdmin) {
        return sock.sendMessage(from, { text: "⚠️ Eu preciso ser admin para banir usuários." });
      }

      // 💡 CORREÇÃO AQUI: Priorizar JID/LID da menção. 
      // Se não for menção, o argumento (arg[0]) é o número.
      // Neste caso, se for um número, usaremos a API do Baileys para formatar corretamente,
      // mas como groupParticipantsUpdate PRECISA de um formato específico,
      // usaremos o JID da menção ou construiremos a string (que o Baileys tentará aceitar)
      
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      
      // Prioriza a menção (que já retorna o JID/LID)
      let alvoJid = mentioned[0]; 
      
      if (!alvoJid) {
          // Se não houver menção, verifica se foi passado um número como argumento.
          const numeroPuro = args[0]?.replace(/[^0-9]/g, "");
          if (numeroPuro) {
              // Converte o número para o formato de JID que o Baileys espera para a ação de grupo.
              // É um JID, mas o Baileys deve lidar com a tradução para LID internamente
              // antes de interagir com a API do WhatsApp.
              alvoJid = numeroPuro + "@s.whatsapp.net"; 
          }
      }
      
      if (!alvoJid) return sock.sendMessage(from, { text: "❌ Uso: .ban @usuário" });

      try {
        await sock.groupParticipantsUpdate(from, [alvoJid], "remove");
        await groupManager.saveGroupData(sock, from, 'member_removed');
        return sock.sendMessage(from, { text: "🔨 Usuário banido!" });
      } catch (error) {
         console.error("Erro ao tentar banir:", error);
        return sock.sendMessage(from, { text: "❌ Erro ao banir. Verifique se o formato do número está correto (com código do país) ou se a menção foi feita corretamente." });
      }
    }

    case "welcome": {
      if (!isGroup) return sock.sendMessage(from, { text: "❌ Só funciona em grupos." });

      const perms = await getPermissions(sock, from, msg.key.participant, BOT_PHONE);
      if (!perms.isAdmin && !perms.isOwnerGroup) {
        return sock.sendMessage(from, { text: "❌ Apenas administradores podem usar." });
      }

      globalConfig.welcomeEnabled = !globalConfig.welcomeEnabled;
      logActivity('CONFIG_CHANGED', {
        setting: 'Boas-vindas',
        value: globalConfig.welcomeEnabled,
        groupId: from,
        groupName: perms.groupName
      });
      
      return sock.sendMessage(from, { text: `🎉 Boas-vindas ${globalConfig.welcomeEnabled ? "✅ ATIVADO" : "❌ DESATIVADO"}` });
    }

case "menu": {
    const helpText =
`✨━━━━━━━━━━━━✨
🌟 *COMANDOS DO ${config.NomeDoBot}*
────────────────────────
🏓 *${config.prefix}ping* → Teste a rapidez do bot.
📈 *${config.prefix}stats* → Estatísticas do grupo. (admin)
💾 *${config.prefix}backup* → Criar backup dos dados. (admin)
🚫 *${config.prefix}antilinkhard* → Anti-link global. (admin)
🔗 *${config.prefix}antilinkgp* → Anti-link em grupo. (admin)
👋 *${config.prefix}welcome* → Ativar boas-vindas. (admin)
❌ *${config.prefix}ban @user* → Banir usuário. (admin)
📜 *${config.prefix}menu* → Mostrar este menu.
────────────────────────
🎶 *${config.prefix}play [música]* → Baixa e envia o áudio do YouTube.
🎵 *${config.prefix}play2 [música]* → (QUEBRADO) Envia um link com a música.
🎥 *${config.prefix}playvid [música]* → Baixa e envia o vídeo do Youtube.
📹 *${config.prefix}playvidhd [música]* → Baixa e envia o vídeo do Youtube em alta resolução (demorado).
📺 *${config.prefix}downloadvid [url]* → Baixa e envia o vídeo do URL.
🔉 *${config.prefix}downloadmp3 [url]* → Baixa e envia o áudio do URL.
🤖 *${config.prefix}gemini [pergunta]* → Faz uma pergunta pra IA do Google Gemini.
⚙️ *${config.prefix}sticker* ou *${config.prefix}s* → Transforma imagem/vídeo em figurinha`;

    return sock.sendMessage(from, {
        image: { url: 'https://xatimg.com/image/J5ODgCTXWhPu.png' },
        caption: helpText,
        quoted: msg
    });
}

    default:
      // 🚨 Comando inválido → gera sugestão
      let sugestao = null;
      let melhorScore = 0;

      for (let cmd of comandos2) {
        const score = similaridade(command, cmd);
        if (score > melhorScore) {
          melhorScore = score;
          sugestao = cmd;
        }
      }

      let mensagem = `🚨 *Comando inválido* 🚨\n`;

      if (sugestao && melhorScore >= 50) {
        mensagem += `Talvez você quis dizer: *${config.prefix}${sugestao}* ?\n`;
        mensagem += `📊 Similaridade: *${melhorScore.toFixed(2)}%*\n`;
      }

      mensagem += `\nUse *${config.prefix}menu* para ver todos os comandos.`;

      return sock.sendMessage(from, { text: mensagem }, { quoted: msg });
  }
}

/* ===========================
   🚀 HANDLER PRINCIPAL
   =========================== */
module.exports = async function (events, sock) {
  try {
    await handleWelcome(sock, events);

    const msg = events.messages?.[0];
    if (!msg?.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith("@g.us");
    const body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      "";

    const BOT_PHONE = (sock?.user?.id || "").split(":")[0]?.replace(/[^0-9]/g, "");
    const messageType = getTipoMensagem(msg);
    
    // Log da mensagem recebida
    const perms = isGroup ? await getPermissions(sock, from, msg.key.participant || msg.key.remoteJid, BOT_PHONE) : {};
    logActivity('MESSAGE_RECEIVED', {
      isGroup,
      groupName: perms.groupName,
      groupId: from,
      messageType
    });
    
    // Salvar dados do grupo e mensagem se for uma mensagem de grupo
    if (isGroup) {
      await groupManager.saveGroupData(sock, from, 'message_activity');
      groupManager.saveMessage(from, msg);
    }

    // 🔥 Resposta quando digitam "prefixo"
    if (body.toLowerCase() === "prefixo") {
        await sock.sendMessage(from, { 
            text: `O prefixo de comandos é: ${config.prefix}` 
        }, { quoted: msg });
    }

    // Listener do botão
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        const buttonResponse = msg.message?.buttonsResponseMessage?.selectedButtonId;

        if (buttonResponse === 'enviar_newsletter') {
            await sock.sendMessage('120363317585508358@newsletter', {
                text: `Mensagem enviada pelo usuário ${msg.key.participant || msg.key.remoteJid}`
            });
            await sock.sendMessage(msg.key.remoteJid, { text: '✅ Sua mensagem foi enviada para a newsletter!' });
        }
    });

    if (await verificarMensagem(sock, from, msg, body, isGroup, BOT_PHONE)) return;

    if (!body.startsWith(config.prefix)) return;
    
    const args = body.slice(config.prefix.length).trim().split(/ +/);
    const command = (args.shift() || "").toLowerCase();

    await handleCommand(sock, from, msg, command, args, { isGroup, BOT_PHONE });

  } catch (error) {
    console.log(chalk.red(`❌ Erro no handler: ${error.message}`));
  }
};

// Limpeza automática de dados antigos a cada 24 horas
setInterval(() => {
  groupManager.cleanOldData();
}, 24 * 60 * 60 * 1000);


