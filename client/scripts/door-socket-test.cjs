const { io } = require('socket.io-client');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const argFile = process.argv[2] || '';
  const raw = require('fs').readFileSync(argFile, 'utf8').replace(/^\uFEFF/, '');
  const { token, characterId } = JSON.parse(raw);
  const s = io('http://localhost:3000', { transports: ['websocket'] });
  let rejected = null;
  let kicked = false;
  let done = false;
  s.on('move:rejected', (p) => { rejected = p; });
  s.on('disconnect', (reason) => { if (!done) { kicked = true; console.log('DISCONNECT:', reason); } });

  await new Promise((res, rej) => {
    s.on('connect', res);
    s.on('connect_error', rej);
    setTimeout(() => rej(new Error('no connect')), 8000);
  });
  s.emit('auth', { token, characterId });
  await sleep(1200);

  const door = { x: 3.6, y: 0.4, z: 48.7 };
  s.emit('player:move', { position: door, direction: { x: 0, y: 0, z: 1 } });
  await sleep(400);

  const enterAck = await new Promise((res) => {
    s.emit('interior:enter', { buildingId: 'tavern' }, (r) => res(r));
    setTimeout(() => res({ ok: false, reason: 'no-ack-timeout' }), 5000);
  });
  console.log('enter ack:', JSON.stringify(enterAck));

  // Ходим внутри комнаты (новый спавн 2632, 2505.5) — движений достаточно,
  // чтобы словить кламп/кик, если бы баг остался
  for (let i = 0; i < 10; i++) {
    s.emit('player:move', {
      position: { x: 2632 + Math.sin(i * 0.5) * 0.6, y: 0.4, z: 2505.5 + ((i * 0.4) % 3) },
      direction: { x: 1, y: 0, z: 0 },
    });
    await sleep(150);
  }
  await sleep(600);

  const exitAck = await new Promise((res) => {
    s.emit('interior:exit', { buildingId: 'tavern' }, (r) => res(r));
    setTimeout(() => res({ ok: false, reason: 'no-ack-timeout' }), 5000);
  });
  console.log('exit ack:', JSON.stringify(exitAck));
  console.log('rejected:', JSON.stringify(rejected), 'kicked:', kicked);
  done = true;
  s.disconnect();

  const ok = enterAck && enterAck.ok && Math.abs(enterAck.target.z - 2505.5) < 0.01
    && exitAck && exitAck.ok && !rejected && !kicked;
  console.log(ok ? 'DOOR FLOW: OK' : 'DOOR FLOW: FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
