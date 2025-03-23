import { Server } from 'socket.io';

export default function SocketHandler(req, res) {
  if (res.socket.server.io) {
    console.log('Socket is already running');
    res.end();
    return;
  }

  const io = new Server(res.socket.server);
  res.socket.server.io = io;

  // ユーザー管理
  const users = {};
  // 待機中のユーザー
  let waitingUsers = [];
  // アクティブな通話ルーム
  const activeRooms = {};

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    users[socket.id] = { id: socket.id, inCall: false };

    // ユーザーがランダムマッチングを要求
    socket.on('find-random-match', () => {
      console.log(`User ${socket.id} is looking for a match`);
      
      // すでに通話中なら何もしない
      if (users[socket.id].inCall) return;
      
      // 待機リストに追加
      waitingUsers.push(socket.id);
      
      // マッチング処理
      matchUsers();
    });

    // シグナリング: オファー送信
    socket.on('send-offer', ({ target, offer }) => {
      console.log(`Sending offer from ${socket.id} to ${target}`);
      io.to(target).emit('receive-offer', { from: socket.id, offer });
    });

    // シグナリング: アンサー送信
    socket.on('send-answer', ({ target, answer }) => {
      console.log(`Sending answer from ${socket.id} to ${target}`);
      io.to(target).emit('receive-answer', { from: socket.id, answer });
    });

    // シグナリング: ICE candidate送信
    socket.on('send-ice-candidate', ({ target, candidate }) => {
      io.to(target).emit('receive-ice-candidate', { from: socket.id, candidate });
    });

    // 通話終了
    socket.on('end-call', ({ roomId }) => {
      if (activeRooms[roomId]) {
        const { user1, user2 } = activeRooms[roomId];
        
        // 両ユーザーに通話終了を通知
        io.to(user1).emit('call-ended');
        io.to(user2).emit('call-ended');
        
        // ユーザーステータス更新
        if (users[user1]) users[user1].inCall = false;
        if (users[user2]) users[user2].inCall = false;
        
        // ルーム削除
        delete activeRooms[roomId];
      }
    });

    // 切断処理
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
      
      // 待機リストから削除
      waitingUsers = waitingUsers.filter(id => id !== socket.id);
      
      // アクティブルームから削除
      Object.keys(activeRooms).forEach(roomId => {
        const room = activeRooms[roomId];
        if (room.user1 === socket.id || room.user2 === socket.id) {
          const otherUser = room.user1 === socket.id ? room.user2 : room.user1;
          
          // 相手に通話終了を通知
          if (otherUser && users[otherUser]) {
            io.to(otherUser).emit('call-ended');
            users[otherUser].inCall = false;
          }
          
          // ルーム削除
          delete activeRooms[roomId];
        }
      });
      
      // ユーザー削除
      delete users[socket.id];
    });
  });

  // ランダムマッチング処理
  function matchUsers() {
    // 待機中のユーザーが2人以上いる場合にマッチング
    while (waitingUsers.length >= 2) {
      const user1 = waitingUsers.shift();
      const user2 = waitingUsers.shift();
      
      // ユーザーが有効かチェック
      if (!users[user1] || !users[user2]) continue;
      
      // ルームID生成
      const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // ルーム情報保存
      activeRooms[roomId] = { user1, user2 };
      
      // ユーザーステータス更新
      users[user1].inCall = true;
      users[user2].inCall = true;
      
      // マッチング通知
      io.to(user1).emit('matched', { roomId, peer: user2 });
      io.to(user2).emit('matched', { roomId, peer: user1 });
      
      console.log(`Matched users ${user1} and ${user2} in room ${roomId}`);
    }
  }

  console.log('Socket server started');
  res.end();
}
