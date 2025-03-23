import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';

// クライアントサイドでのみSocket.ioをインポート
const io = dynamic(() => import('socket.io-client'), {
  ssr: false,
});

// クライアントサイドでのみSimple Peerをインポート
const Peer = dynamic(() => import('simple-peer'), {
  ssr: false,
});

import { v4 as uuidv4 } from 'uuid';

// グローバル変数
let socket;

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [callStatus, setCallStatus] = useState('');
  
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const roomIdRef = useRef(null);
  const peerIdRef = useRef(null);

  // Socket.io接続の初期化
  useEffect(() => {
    // クライアントサイドでのみ実行
    if (typeof window === 'undefined') return;

    const initSocket = async () => {
      try {
        await fetch('/api/socket');
        
        // Socket.ioクライアントの初期化
        const socketIo = await import('socket.io-client');
        socket = socketIo.default({
          path: '/api/socketio',
        });

        socket.on('connect', () => {
          console.log('Socket connected');
          setIsConnected(true);
        });

        socket.on('disconnect', () => {
          console.log('Socket disconnected');
          setIsConnected(false);
          handleCallEnd();
        });

        socket.on('matched', ({ roomId, peer }) => {
          console.log(`Matched with peer ${peer} in room ${roomId}`);
          roomIdRef.current = roomId;
          peerIdRef.current = peer;
          setCallStatus('マッチングしました！接続中...');
          startCall(true);
        });

        socket.on('receive-offer', async ({ from, offer }) => {
          console.log(`Received offer from ${from}`);
          if (peerRef.current) {
            peerRef.current.signal(offer);
          }
        });

        socket.on('receive-answer', ({ from, answer }) => {
          console.log(`Received answer from ${from}`);
          if (peerRef.current) {
            peerRef.current.signal(answer);
          }
        });

        socket.on('receive-ice-candidate', ({ from, candidate }) => {
          if (peerRef.current) {
            peerRef.current.signal(candidate);
          }
        });

        socket.on('call-ended', () => {
          console.log('Call ended by peer');
          setCallStatus('相手が通話を終了しました');
          handleCallEnd();
        });
      } catch (error) {
        console.error('Socket initialization error:', error);
        setCallStatus('サーバー接続エラー');
      }
    };

    initSocket();

    return () => {
      if (socket) {
        socket.disconnect();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // ランダムマッチング開始
  const findRandomMatch = () => {
    if (!isConnected) {
      setCallStatus('サーバーに接続されていません');
      return;
    }

    setIsSearching(true);
    setCallStatus('相手を探しています...');
    socket.emit('find-random-match');
  };

  // 通話開始
  const startCall = async (isInitiator) => {
    try {
      // マイクへのアクセス許可を取得
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
      }

      // Simple Peerのインポート
      const SimplePeer = await import('simple-peer');

      // WebRTC Peer接続の設定
      const peer = new SimplePeer.default({
        initiator: isInitiator,
        trickle: true,
        stream: stream
      });

      peer.on('signal', data => {
        if (isInitiator) {
          socket.emit('send-offer', { target: peerIdRef.current, offer: data });
        } else {
          socket.emit('send-answer', { target: peerIdRef.current, answer: data });
        }
      });

      peer.on('stream', stream => {
        setCallStatus('通話中');
        setInCall(true);
        setIsSearching(false);
        
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
        }
      });

      peer.on('close', () => {
        handleCallEnd();
      });

      peer.on('error', err => {
        console.error('Peer error:', err);
        setCallStatus('接続エラーが発生しました');
        handleCallEnd();
      });

      peerRef.current = peer;

    } catch (err) {
      console.error('Failed to get media devices:', err);
      setCallStatus('マイクへのアクセスが拒否されました');
      setIsSearching(false);
    }
  };

  // 通話終了
  const endCall = () => {
    if (roomIdRef.current && socket) {
      socket.emit('end-call', { roomId: roomIdRef.current });
    }
    handleCallEnd();
  };

  // 通話終了処理
  const handleCallEnd = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    if (localAudioRef.current) {
      localAudioRef.current.srcObject = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    roomIdRef.current = null;
    peerIdRef.current = null;
    setInCall(false);
    setIsSearching(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-500 to-indigo-700 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h1 className="text-3xl font-bold text-center text-indigo-700 mb-6">toro</h1>
        <p className="text-center text-gray-600 mb-8">ランダム音声チャットアプリ</p>
        
        <div className="mb-6 text-center">
          <div className="text-sm text-gray-500 mb-2">ステータス</div>
          <div className={`font-medium ${inCall ? 'text-green-600' : 'text-gray-700'}`}>
            {isConnected ? (callStatus || 'サーバーに接続されています') : '接続中...'}
          </div>
        </div>

        <div className="flex justify-center mb-8">
          {!inCall && !isSearching ? (
            <button
              onClick={findRandomMatch}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-full shadow-lg transition duration-300 transform hover:scale-105"
              disabled={!isConnected}
            >
              ランダムマッチング開始
            </button>
          ) : inCall ? (
            <button
              onClick={endCall}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-full shadow-lg transition duration-300"
            >
              通話終了
            </button>
          ) : (
            <button
              className="bg-gray-400 text-white font-bold py-3 px-6 rounded-full shadow-lg cursor-not-allowed"
              disabled
            >
              相手を探しています...
            </button>
          )}
        </div>

        <div className="text-center text-sm text-gray-500">
          <p>マイクへのアクセスを許可してください</p>
          <p className="mt-1">ランダムな相手と音声チャットを楽しみましょう</p>
        </div>
      </div>

      <audio ref={localAudioRef} autoPlay muted className="hidden" />
      <audio ref={remoteAudioRef} autoPlay className="hidden" />
      
      <footer className="mt-8 text-center text-white text-sm opacity-70">
        <p>© 2025 toro - ランダム音声チャットアプリ</p>
      </footer>
    </div>
  );
}
