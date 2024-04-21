const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const express = require('express');
const app = express();
const server = http.createServer(app);
const cors = require('cors');
const csv = require('csv-parser');
const bcrypt = require('bcrypt');
app.use(express.json());
//tkm:tkm123@ SQL USER
const corsOptions = {
    origin: '*',  // or use "*" to allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Methods allowed
    allowedHeaders: ['Content-Type', 'Authorization'], // Headers allowed in requests
    credentials: true, // Allow cookies and authentication headers to be sent along
    optionsSuccessStatus: 200 // Some browsers like IE11 use 200 instead of 204
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // this line handles preflight request
app.get('/', (req, res) => {
    res.send('Hello World!');
});
const wss = new WebSocket.Server({ port: 3000 });
const clients = new Map();  // Keep track of all connected clients
const { v4: uuidv4 } = require('uuid');
let successfulITSIds = new Set();

const mysql = require('mysql2');
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'tkm',
    password: 'tkm123@',
    database: 'ITS_SCAN_APP'
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
    } else {
        console.log('Connected to MySQL!');
    }
});

wss.on('connection', (ws) => {
    const userId = uuidv4(); // Generate a unique user ID
    clients.set(userId, ws); // Store the client with its ID
  
    console.log(`NEW USER CONNECTED with ID: ${userId}`);
  
    let formattedData = Array.from(successfulITSIds).map(its => 
        `${its.id},${its.name};`
    ).join('');
  
    ws.send(formattedData);
  
    ws.on('message', async (message) => {
      console.log(`Message received from user ID: ${userId}`);
      // Add additional message handling logic here
    });
  
    ws.on('close', () => {
      clients.delete(userId); // Use the user ID to remove the client
      console.log(`Client with ID ${userId} disconnected`);
    });
  });

// Helper function to check if an ID is already in the set
function isDuplicateId(trimmedId) {
    return Array.from(successfulITSIds).some((item) => item.id === trimmedId);
  }
  
  // Function to look up ITS IDs from a CSV file
  function lookupITS(ids) {
    let idsArray = Array.isArray(ids) ? ids : [ids]; // Ensure input is always an array
    let successCount = 0;
    let failedCount = 0;
    let duplicateCount = 0;
  
    return new Promise((resolve, reject) => {
      const results = [];
  
      const processId = (trimmedId) => {
        let matchFound = false; // Flag to track if a match is found
  
        // Check for duplicates in successful ITS IDs
        if (isDuplicateId(trimmedId)) {
          console.log('Duplicate ITS ID detected:', trimmedId);
          duplicateCount++; // Increment duplicate count
          return; // Skip further processing for duplicates
        }
  
        // If not a duplicate, read from CSV to find a match
        try {
          fs.createReadStream('data.csv')
            .pipe(csv())
            .on('data', (data) => {
              const csvId = data.ITS_ID.trim(); // Get ID from CSV
  
              if (csvId === trimmedId) { // If match found
                matchFound = true; // Set flag
                const matchedITS = {
                  id: csvId,
                  name: data.Name.trim(),
                };
  
                console.log('Match found:', matchedITS);
                results.push(matchedITS);
                broadcastMatchedITS(matchedITS);
                successfulITSIds.add(matchedITS); // Add to successful ITS IDs
                successCount++; // Increment success count
              }
            })
            .on('end', () => {
              // Check if no match was found after processing CSV
              if (!matchFound) {
                console.log("No match found for ITS ID:", trimmedId);
                failedCount++; // Increment failed count when no match is found
              }
            })
            .on('error', (err) => {
              console.error('Error during CSV processing:', err);
              failedCount++; // Increment failed count on error
            });
        } catch (error) {
          console.error('Error processing ITS ID:', trimmedId, error);
          failedCount++; // Increment failed count in case of exception
        }
      };
  
      // Process each ITS ID
      for (const itsId of idsArray) {
        const trimmedId = itsId.trim(); // Ensure ID is trimmed
        processId(trimmedId); // Process the current ITS ID
      }
  
      // Set a timeout to ensure all processing is complete before resolving
      setTimeout(() => {
        console.log("All processing done.");
        resolve({
          results,
          statistics: {
            successCount,
            failedCount,
            duplicateCount,
          },
        });
      }, 1000); // Set timeout to ensure all processing has finished
    });
  }

function broadcastMatchedITS(matchedITS) {
    // Convert the matchedITS object to a semicolon-separated string
    const formattedData = `${matchedITS.id},${matchedITS.name};`;
    const clientIds = []; // List to keep track of client IDs to whom the message is sent
  // Broadcast the formatted data to all connected WebSocket clients
  clients.forEach((client, userId) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(formattedData);
      clientIds.push(userId); // Add the client ID to the list
    }
  });

  console.log(`Message sent to client IDs: ${clientIds.join(', ')}`);
}

// Define API endpoint
app.post('/lookupITS', async (req, res) => {
    try {
        const itsId = req.body.itsId;
        console.log(itsId);
        // Perform ITS lookup
        const results = await lookupITS(itsId);
        // Send the results back to the client
        res.status(200).json(results);
    } catch (error) {
        console.error('Error looking up ITS:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/uploadIds', async (req, res) => {
    try {
        console.log(req.body.itsIds);
        console.log(req.body);
        const ids = req.body.itsIds; // This should already be an array if sent correctly
        console.log('Received ITS IDs:', ids);

        // Perform ITS lookup, assuming lookupITS can handle an array of IDs
        const { results, statistics } = await lookupITS(ids);
        console.log(statistics);
        // Send the results and statistics back to the client
        res.status(200).json({ results, statistics });
    } catch (error) {
        console.error('Error processing ITS IDs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/register', async (req, res) => {
    const { its_id, username, password, role, tkm_mohalla, designation } = req.body;

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 10);

    const query = 'INSERT INTO users (its_id, username, password_hash, role, tkm_mohalla, designation) VALUES (?, ?, ?, ?, ?, ?)';
    connection.query(query, [its_id, username, passwordHash, role, tkm_mohalla, designation], (err, results) => {
        if (err) {
            console.error('Error registering user:', err);
            res.status(500).json({ error: 'Internal server error' });
        } else {
            res.status(201).json({ message: 'User registered successfully!' });
        }
    });
});

app.post('/login', async (req, res) => {
    const { its_id, password } = req.body;

    const query = 'SELECT * FROM users WHERE its_id = ?';
    connection.query(query, [its_id], async (err, results) => {
        if (err) {
            console.error('Error during login:', err);
            res.status(500).json({ error: 'Internal server error' });
        } else if (results.length === 0) {
            res.status(404).json({ error: 'User not found' });
        } else {
            const user = results[0];
            const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);

            if (isPasswordCorrect) {
                const token = jwt.sign({ user_id: user.user_id, role: user.role }, 'your_jwt_secret', { expiresIn: '1h' });
                res.status(200).json({ token });
            } else {
                res.status(401).json({ error: 'Invalid credentials' });
            }
        }
    });
});


app.get('/users/:its_id', (req, res) => {
    const its_id = req.params.its_id;

    const query = 'SELECT * FROM users WHERE its_id = ?';
    connection.query(query, [its_id], (err, results) => {
        if (err) {
            console.error('Error fetching user:', err);
            res.status(500).json({ error: 'Internal server error' });
        } else if (results.length === 0) {
            res.status(404).json({ error: 'User not found' });
        } else {
            res.status(200).json(results[0]);
        }
    });
});

app.put('/users/:its_id', async (req, res) => {
    const its_id = req.params.its_id;
    const { username, password, role, tkm_mohalla, designation } = req.body;

    let updateFields = [];
    let values = [];

    if (username) {
        updateFields.push('username = ?');
        values.push(username);
    }

    if (password) {
        const passwordHash = await bcrypt.hash(password, 10);
        updateFields.push('password_hash = ?');
        values.push(passwordHash);
    }

    if (role) {
        updateFields.push('role = ?');
        values.push(role);
    }

    if (tkm_mohalla) {
        updateFields.push('tkm_mohalla = ?');
        values.push(tkm_mohalla);
    }

    if (designation) {
        updateFields.push('designation = ?');
        values.push(designation);
    }

    const query = `UPDATE users SET ${updateFields.join(', ')} WHERE its_id = ?`;
    values.push(its_id);

    connection.query(query, values, (err, results) => {
        if (err) {
            console.error('Error updating user:', err);
            res.status(500).json({ error: 'Internal server error' });
        } else {
            res.status(200).json({ message: 'User updated successfully!' });
        }
    });
});

app.delete('/users/:its_id', (req, res) => {
    const its_id = req.params.its_id;

    const query = 'DELETE FROM users WHERE its_id = ?';
    connection.query(query, [its_id], (err, results) => {
        if (err) {
            console.error('Error deleting user:', err);
            res.status(500).json({ error: 'Internal server error' });
        } else {
            res.status(200).json({ message: 'User deleted successfully!' });
        }
    });
});


const port = 8080;
server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
