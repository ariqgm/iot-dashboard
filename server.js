  const express = require('express');
  const path = require('path');
  const mqtt = require('mqtt');
  const http = require('http');
  const socketIo = require('socket.io');
  const mysql = require('mysql2');

  const app = express();
  const server = http.createServer(app);
  const io = socketIo(server);

  const PORT = 3000;

  // Menggunakan express untuk menyajikan file statis dari direktori 'public'
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Konfigurasi MySQL
  const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '', // Ganti dengan password database Anda
    database: 'tugas_akhir' // Ganti dengan nama database Anda
  });

  db.connect((err) => {
    if (err) {
      console.error('Failed to connect to database:', err);
    } else {
      console.log('Connected to database');
    }
  });

  let roomLockStatus = false;
  let mainLockStatus = false;
  let lastDimmerValue = 0; // Inisialisasi nilai dimmer terakhir
  let lampStatus = false;

  // Konfigurasi MQTT
  const mqttClient = mqtt.connect('mqtt://192.168.42.106:1883', {
    username: 'ariq',
    password: '1234'
  });

  mqttClient.on('connect', function () {
    console.log('Connected to MQTT broker');
    const topics = ['Status_Daya_Beban_Listrik/#', 'proteksi_digital', 'home/status'];
    topics.forEach(topic => {
      mqttClient.subscribe(topic, function (err) {
        if (err) {
          console.error(`Failed to subscribe to ${topic}:`, err);
        }
      });
    });
  });

  mqttClient.on('message', function (topic, message) {
    console.log('Received message:', topic, message.toString());
    try {
      const data = JSON.parse(message.toString());
      if (topic.startsWith('Status_Daya_Beban_Listrik/')) {
        io.emit('mqttDataStatusDaya', { topic, data });
        console.log('Emitted mqttData:', { topic, data });
      } else if (topic === 'proteksi_digital') {
        io.emit('mqttDataProteksi', { topic, data });
        console.log('Emitted mqttData:', { topic, data });
      } else if (topic === 'home/status') {
        roomLockStatus = data.room_lock_status;
        mainLockStatus = data.main_lock_status;
        lastDimmerValue = data.dimmer_value;
        lampStatus = data.lamp_status;

        io.emit('statusData', data);
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  });

  io.on('connection', (socket) => {
    console.log('New client connected');

    // Kirim status tombol saat klien terhubung
    socket.emit('statusButtons', {
      roomLockStatus,
      mainLockStatus
    });

    // Kirim nilai dimmer terakhir saat klien terhubung
    socket.emit('dimmerValue', {
      value: lastDimmerValue
    });

    // Kirim data history saat klien terhubung
    const sendhistorySmarthomeData = () => {
      const query = 'SELECT timestamp, bedroom_door, main_room_door, lamp_bedroom, dimmer, LDR AS light_intensity, mq2 AS mq2 FROM smarthome ORDER BY timestamp DESC LIMIT 100';
      db.query(query, (err, results) => {
        if (err) {
          console.error('Failed to fetch history data:', err);
        } else {
          socket.emit('requesthistorySmarthomeData', results);
        }
      });
    };

    const sendhistoryProteksiData = () => {
      const query = 'SELECT * FROM proteksi_digital ORDER BY timestamp DESC LIMIT 100';
      db.query(query, (err, results) => {
        if (err) {
          console.error('Failed to fetch history data:', err);
        } else {
          socket.emit('requesthistoryProteksiData', results);
        }
      });
    };

    const sendhistoryStatusListrikData = () => {
      const query = 'SELECT * FROM status_beban_daya_listrik ORDER BY timestamp DESC LIMIT 100';
      db.query(query, (err, results) => {
        if (err) {
          console.error('Failed to fetch history data:', err);
        } else {
          socket.emit('requesthistoryStatusListrikData', results);
        }
      });
    };

    const senddata15menit = () => {
      const query = 'SELECT * FROM proteksi_digital WHERE timestamp >= NOW() - INTERVAL 15 MINUTE ORDER BY timestamp ASC';
      db.query(query, (err, results) => {
        if (err) {
          console.error('Failed to fetch history data:', err);
        } else {
          socket.emit('requestdata15menit', results);
        }
      });
    };

    const fetchProteksiData = (callback) => {
      const query = `SELECT current FROM proteksi_digital 
                    WHERE timestamp >= NOW() - INTERVAL 15 MINUTE 
                    ORDER BY timestamp ASC`;
      db.query(query, (err, results) => {
        if (err) {
          console.error('Failed to fetch proteksi data:', err);
        } else {
          callback(results);
        }
      });
    };

    const sendProteksiData = () => {
      fetchProteksiData((results) => {
        socket.emit('proteksiData', results);
      });
    };

    sendProteksiData();
    sendhistorySmarthomeData();
    sendhistoryProteksiData();
    sendhistoryStatusListrikData();
    senddata15menit();
 
    socket.on('requesthistorySmarthomeData', sendhistorySmarthomeData);
    socket.on('requesthistoryProteksiData', sendhistoryProteksiData);
    socket.on('requesthistoryStatusListrikData', sendhistoryStatusListrikData);
    socket.on('requestdata15menit', senddata15menit);
    socket.on('requestProteksiData', sendProteksiData);

    socket.on('requestDimmerValue', () => {
      socket.emit('dimmerValue', {
        value: lastDimmerValue
      });
    });

    socket.on('requestStatusButtons', () => {
      socket.emit('statusButtons', {
        roomLockStatus,
        mainLockStatus
      });
    });

    socket.on('control', (message) => {
      const { device, value } = message;
      console.log('Control device:', device, 'Value:', value);
      if (device === 'room_lock') {
        roomLockStatus = value === 'LOCK';
        mqttClient.publish('kontrol/room_lock', value || 'TOGGLE');
      } else if (device === 'main_lock') {
        mainLockStatus = value === 'LOCK';
        mqttClient.publish('kontrol/main_lock', value || 'TOGGLE');
      } else if (device === 'dimmer') {
        lastDimmerValue = value; // Update lastDimmerValue when dimmer value is changed
        mqttClient.publish('kontrol/dimmer', String(value));
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected');
    });
  });

  // Menjalankan server
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
