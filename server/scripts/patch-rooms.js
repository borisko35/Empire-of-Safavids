// Заменяет региональные комнаты сокетов на шардовые
// Запуск: node scripts/patch-rooms.js из server/
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'src', 'socket', 'GameSocketHandler.ts');
let s = fs.readFileSync(file, 'utf8');

const regionRoom = 'socket.to(`region:${socket.region}`)';
const shardRegionRoom = 'socket.to(`shard:${socket.shardId}:region:${socket.region}`)';
const count = s.split(regionRoom).length - 1;
s = s.split(regionRoom).join(shardRegionRoom);

s = s.replace(
  'this.io.emit(SOCKET_EVENTS.CHAT_WORLD, payload);',
  'this.io.to(`shard:${socket.shardId}`).emit(SOCKET_EVENTS.CHAT_WORLD, payload);'
);
s = s.replace(
  'this.io.to(`region:${socket.region}`).emit(SOCKET_EVENTS.CHAT_REGION, payload);',
  'this.io.to(`shard:${socket.shardId}:region:${socket.region}`).emit(SOCKET_EVENTS.CHAT_REGION, payload);'
);

fs.writeFileSync(file, s);
console.log('regional rooms shardified:', count);
