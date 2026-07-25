const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

// Configuração do Socket.IO permitindo conexão de qualquer origem
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Banco de dados em memória para as salas ativas
const rooms = {};

// Função para gerar código aleatório de 6 caracteres
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log(`[+] Novo jogador conectado: ${socket.id}`);

    // Criar sala
    socket.on('createRoom', (hostName, callback) => {
        const roomId = generateRoomCode();
        
        rooms[roomId] = {
            id: roomId,
            host: socket.id,
            hostName: hostName,
            client: null,
            clientName: null,
            status: 'waiting'
        };

        socket.join(roomId);
        console.log(`[ROOM] Sala ${roomId} criada por ${hostName}`);
        
        callback({ success: true, roomId: roomId });
    });

    // Entrar em sala
    socket.on('joinRoom', (data, callback) => {
        const { code, playerName } = data;
        const room = rooms[code];

        if (!room) {
            return callback({ success: false, error: "Sala não encontrada." });
        }
        if (room.status !== 'waiting') {
            return callback({ success: false, error: "A sala já está em partida ou cheia." });
        }

        // Adiciona o jogador 2
        room.client = socket.id;
        room.clientName = playerName;
        room.status = 'ready';
        socket.join(code);

        console.log(`[ROOM] ${playerName} entrou na sala ${code}`);

        // Avisa o host que o rival entrou
        socket.to(room.host).emit('playerJoined', playerName);

        // Retorna sucesso para o jogador 2 com o nome do host
        callback({ success: true, hostName: room.hostName });
    });

    // Iniciar partida (Host chama isso)
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id) {
            room.status = 'playing';
            // Avisa o P2 (client) que o jogo começou
            socket.to(roomId).emit('matchStarted');
            console.log(`[ROOM] Partida iniciada na sala ${roomId}`);
        }
    });

    // Sincronização de Estado: Host -> Client
    socket.on('hostState', (data) => {
        // Envia de forma volátil (se perder um pacote, ignora e pega o mais recente)
        socket.to(data.code).volatile.emit('serverState', data.state);
    });

    // Sincronização de Inputs: Client -> Host
    socket.on('clientInput', (data) => {
        socket.to(data.code).volatile.emit('clientState', data.input);
    });

    // Sair da sala intencionalmente
    socket.on('leaveRoom', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            socket.to(roomId).emit('opponentLeft');
            delete rooms[roomId];
            console.log(`[ROOM] Sala ${roomId} encerrada.`);
        }
    });

    // Desconexão acidental
    socket.on('disconnect', () => {
        console.log(`[-] Jogador desconectado: ${socket.id}`);
        // Procurar se ele estava em alguma sala e encerrá-la
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.host === socket.id || room.client === socket.id) {
                socket.to(roomId).emit('opponentLeft');
                delete rooms[roomId];
                console.log(`[ROOM] Sala ${roomId} deletada pois um jogador caiu.`);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[SERVER] Rodando na porta ${PORT}`);
});