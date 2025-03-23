import { useEffect, useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import io from 'socket.io-client';
import Peer from 'simple-peer';

let socket;

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [callStatus, setCallStatus] = useState('');
  const [roomId, setRoomId] = useState(null);
  const [peerId, setPeerId] = useState(null);
  
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);

  // Socket.io接続の初期化
  useEffect(() => {
    const initSocket = async () => {
      await fetch('/api/socket');
      socket = io();

      socket.on('connect', () => {
        console.log('Socket connected');
        setIsConnected(true);
      });

      socket.on('disconnect', () => {
        console.log('Socket disconnected');
        setIsConnected(false);
        handleCallEnd();
      });

      // マッチング成功時
      socket.on('matched', ({ roomId, peer }) => {
        console.log(`Matched with ${peer} in room ${roomId}`);
        setIsSearching(false);
        setInCall(true);
        setRoomId(roomId);
        setPeerId(peer);
        setCallStatus('接続中...');
        
        // 発信側はオファーを作成
        startCall(peer, true);
      });

      // オファー受信時
      socket.on('receive-offer', async ({ from, offer }) => {
        console.log(`Received offer from ${from}`);
        if (!inCall) return;
        
        // 着信側はオファーを受け取り、アンサーを作成
        await handleReceiveOffer(from, offer);
      });

      // アンサー受信時
      socket.on('receive-answer', ({ from, answer }) => {
        console.log(`Received answer from ${from}`);
        if (!inCall || !peerRef.current) return;
        
        peerRef.current.signal(answer);
      });

      // ICE candidate受信時
      socket.on('receive-ice-candidate', ({ from, candidate }) => {
        console.log(`Received ICE candidate from ${from}`);
        if (!inCall || !peerRef.current) return;
        
        peerRef.current.signal(candidate);
      });

      // 通話終了時
      socket.on('call-ended', () => {
        console.log('Call ended by peer');
        handleCallEnd();
      });

      return () => {
        if (socket) {
          socket.disconnect();
        }
      };
    };

    initSocket();
  }, []);

  // 通話開始処理
  const startCall = async (targetPeerId, isInitiator) => {
    try {
      // マイクの音声ストリームを取得
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      
      // ローカルの音声をミュート（自分の声が自分に聞こえないようにする）
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
        localAudioRef.current.muted = true;
      }

      // WebRTC Peer接続の設定
      const peer = new Peer({
        initiator: isInitiator,
        trickle: true,
        stream: stream,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });

      // シグナリングデータ送信時
      peer.on('signal', data => {
        console.log('Generated signal data', data.type);
        
        if (data.type === 'offer') {
          socket.emit('send-offer', { target: targetPeerId, offer: data });
        } else if (data.type === 'answer') {
          socket.emit('send-answer', { target: targetPeerId, answer: data });
        } else {
          socket.emit('send-ice-candidate', { target: targetPeerId, candidate: data });
        }
      });

      // 相手のストリーム受信時
      peer.on('stream', stream => {
        console.log('Received remote stream');
        setCallStatus('通話中');
        
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch(err => console.error('Error playing audio:', err));
        }
      });

      // 接続確立時
      peer.on('connect', () => {
        console.log('Peer connection established');
        setCallStatus('通話中');
      });

      // エラー発生時
      peer.on('error', err => {
        console.error('Peer connection error:', err);
        setCallStatus('エラーが発生しました');
        handleCallEnd();
      });

      // 接続終了時
      peer.on('close', () => {
        console.log('Peer connection closed');
        handleCallEnd();
      });

      peerRef.current = peer;
    } catch (err) {
      console.error('Error starting call:', err);
      setCallStatus('マイクへのアクセスに失敗しました');
      handleCallEnd();
    }
  };

  // オファー受信処理
  const handleReceiveOffer = async (from, offer) => {
    try {
      // 着信側のPeer接続を開始
      await startCall(from, false);
      
      // 受信したオファーを設定
      peerRef.current.signal(offer);
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  };

  // ランダムマッチング開始
  const findRandomMatch = () => {
    if (!isConnected) return;
    
    setIsSearching(true);
    setCallStatus('相手を探しています...');
    socket.emit('find-random-match');
  };

  // 通話終了処理
  const handleCallEnd = () => {
    setInCall(false);
    setIsSearching(false);
    setCallStatus('');
    setPeerId(null);
    
    // ルームIDがある場合は通話終了を通知
    if (roomId) {
      socket.emit('end-call', { roomId });
      setRoomId(null);
    }
    
    // Peer接続を閉じる
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    
    // ローカルストリームを停止
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
  };

  return (
    <div className="container">
      <main>
        <h1 className="title">toro</h1>
        <p className="description">ランダム音声チャットアプリ</p>

        <div className="chat-container">
          {/* ステータス表示 */}
          <div className="status-area">
            <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? 'オンライン' : 'オフライン'}
            </div>
            {callStatus && <div className="call-status">{callStatus}</div>}
          </div>

          {/* 音声要素（非表示） */}
          <audio ref={localAudioRef} autoPlay playsInline muted />
          <audio ref={remoteAudioRef} autoPlay playsInline />

          {/* アクション領域 */}
          <div className="action-area">
            {!inCall ? (
              <button 
                className={`match-button ${isSearching ? 'searching' : ''}`}
                onClick={findRandomMatch}
                disabled={!isConnected || isSearching}
              >
                {isSearching ? '検索中...' : 'ランダムマッチング'}
              </button>
            ) : (
              <button 
                className="end-call-button"
                onClick={handleCallEnd}
              >
                通話を終了
              </button>
            )}
          </div>
        </div>
      </main>

      <footer>
        <p>Powered by Next.js, WebRTC and Socket.io</p>
      </footer>

      <style jsx>{`
        .container {
          min-height: 100vh;
          padding: 0 0.5rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          background: linear-gradient(135deg, #6e8efb, #a777e3);
        }

        main {
          padding: 5rem 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }

        footer {
          width: 100%;
          height: 50px;
          border-top: 1px solid #eaeaea;
          display: flex;
          justify-content: center;
          align-items: center;
          background-color: rgba(255, 255, 255, 0.1);
        }

        footer p {
          color: white;
        }

        .title {
          margin: 0;
          line-height: 1.15;
          font-size: 4rem;
          color: white;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
        }

        .description {
          text-align: center;
          line-height: 1.5;
          font-size: 1.5rem;
          color: white;
          margin-bottom: 2rem;
        }

        .chat-container {
          width: 100%;
          max-width: 500px;
          background-color: white;
          border-radius: 15px;
          padding: 2rem;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .status-area {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 2rem;
        }

        .status-indicator {
          padding: 0.5rem 1rem;
          border-radius: 20px;
          font-weight: bold;
          margin-bottom: 1rem;
        }

        .connected {
          background-color: #4caf50;
          color: white;
        }

        .disconnected {
          background-color: #f44336;
          color: white;
        }

        .call-status {
          font-size: 1.2rem;
          color: #333;
        }

        .action-area {
          width: 100%;
          display: flex;
          justify-content: center;
        }

        .match-button, .end-call-button {
          padding: 1rem 2rem;
          font-size: 1.2rem;
          border: none;
          border-radius: 50px;
          cursor: pointer;
          transition: all 0.3s ease;
          font-weight: bold;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .match-button {
          background-color: #4caf50;
          color: white;
        }

        .match-button:hover {
          background-color: #388e3c;
          transform: translateY(-2px);
        }

        .match-button:disabled {
          background-color: #cccccc;
          cursor: not-allowed;
          transform: none;
        }

        .searching {
          animation: pulse 1.5s infinite;
        }

        .end-call-button {
          background-color: #f44336;
          color: white;
        }

        .end-call-button:hover {
          background-color: #d32f2f;
          transform: translateY(-2px);
        }

        @keyframes pulse {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.05);
          }
          100% {
            transform: scale(1);
          }
        }
      `}</style>

      <style jsx global>{`
        html,
        body {
          padding: 0;
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto,
            Oxygen, Ubuntu, Cantarell, Fira Sans, Droid Sans, Helvetica Neue,
            sans-serif;
        }

        * {
          box-sizing: border-box;
        }
      `}</style>
    </div>
  );
}
