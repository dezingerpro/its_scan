const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const express = require('express');
const app = express();
const server = http.createServer(app);
const cors = require('cors');
const csv = require('csv-parser');
const bcrypt = require('bcrypt');
const ExcelJS = require('exceljs');
const path = require('path');

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
const wss = new WebSocket.Server({ noServer: true }); // Create WebSocket server without direct port binding

const clients = new Map();  // Keep track of all connected clients
const { v4: uuidv4 } = require('uuid');
let successfulITSIds = new Set();

const mysql = require('mysql2'); // Use mysql2 for asynchronous MySQL operations
const connection = mysql.createConnection({
  host: '13.214.60.179',
  user: 'tkm',
  password: 'Tkm5253@',
  database: 'its_scanning_app'
});

connection.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
  } else {
    console.log('Connected to MySQL!');
  }
});


const clientsByLocationAndEvent = new Map(); // Key: (location_ID, event_ID), Value: Set of WebSocket connections

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost'); // Create a URL object

  const location = url.searchParams.get('location'); // Extract 'location' from query parameters
  const event = url.searchParams.get('event'); // Extract 'event' from query parameters
  if (!location || !event) { // If either parameter is missing, close the connection
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); // Send HTTP error response
    socket.destroy();
    return;
  }

  // Pass 'location' and 'event' metadata to the WebSocket connection
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, { location, event });
  });
});

//  let formattedData = Array.from(successfulITSIds).map(its => 
//         `${its.id},${its.name};`
//     ).join('');

//     ws.send(formattedData);


wss.on('connection', (ws, metadata) => {
  const userId = uuidv4(); // Generate a unique user ID
  const { location, event } = metadata; // Extract metadata from the connection
  ws.metadata = { location, event }; // Store metadata in the WebSocket
  ws.userId = userId; // Store userId in the WebSocket for later reference

  const clientSetKey = `${location}_${event}`; // Create a unique key for this location and event

  // Ensure a structure with both a set of WebSocket connections and a set of userId
  if (!clientsByLocationAndEvent.has(clientSetKey)) {
    clientsByLocationAndEvent.set(clientSetKey, { connections: new Set(), userIds: new Set() }); // Initialize with sets
  }

  const clientData = clientsByLocationAndEvent.get(clientSetKey); // Get the data for this key
  clientData.connections.add(ws); // Add the WebSocket connection
  clientData.userIds.add(userId); // Add the userId to the set

  console.log(`New user connected with location: ${location}, event: ${event}, userId: ${userId}`);

  ws.on('message', (message) => {
    console.log(`Message received from user ID: ${userId}: ${message}`);
    // Add message handling logic here
  });

  ws.on('close', () => {
    clientData.connections.delete(ws); // Remove the WebSocket connection
    clientData.userIds.delete(userId); // Remove the userId from the set
    console.log(`User disconnected from location: ${location}, event: ${event}, userId: ${userId}`);
  });
});

// Helper function to check if an ID is already in the set
function isDuplicateId(trimmedId) {
  return Array.from(successfulITSIds).some((item) => item.id === trimmedId);
}


function lookupITS(ids, location, event) {
  let idsArray = Array.isArray(ids) ? ids : [ids]; // Ensure input is always an array
  let successCount = 0;
  let failedCount = 0;
  let duplicateCount = 0;

  return new Promise((resolve, reject) => {
    const results = [];
    const completedIds = new Set(); // Track which IDs have been processed

    const processId = async (trimmedId) => {
      if (completedIds.has(trimmedId)) {
        return; // Avoid processing the same ID multiple times
      }

      let matchFound = false; // Flag to track if a match is found

      if (isDuplicateId(trimmedId)) { // Check for duplicates
        duplicateCount++; // Increment duplicate count
        return;
      }

      try {
        fs.createReadStream('data.csv')
          .pipe(csv())
          .on('data', async (data) => {
            const csvId = data.Mumin_ID.trim(); // Get ID from CSV

            if (csvId === trimmedId) { // If match found
              matchFound = true; // Set flag
              const matchedITS = {
                id: csvId,
                name: data.Full_Name.trim(),
              };

              const dataITS = {
                id: csvId,
                name: data.Full_Name.trim(),
                gate: data.Gate.trim(),
                seat_name: data.Seat_Name.trim(),
                gender: data.Gender.trim(),
              };

              console.log(matchedITS);
              console.log(dataITS);

              // Insert into MySQL table
              //const query = 'INSERT INTO Miqaat_data (its_id, its_name) VALUES (?, ?)';
              //connection.query(query, [matchedITS.id, matchedITS.name]); // Store in MySQL
              results.push(dataITS);
              broadcastMatchedITS(matchedITS, location, event); // Broadcast to clients
            }
          })
          .on('end', () => {
            if (!matchFound) {
                  const dataITS = {
                  id: trimmedId,
                  name: "Unknown",
                  gate: "Unknown",
                  seat_name: "Unknown",
                  gender: "Unknown",
                };
                const matchedITS = {
                  id: trimmedId,
                  name: "Unknown",
                };
                results.push(dataITS);
                broadcastMatchedITS(matchedITS, location, event); // Broadcast to clients
              failedCount++; // Increment failed count when no match is found
            }
            completedIds.add(trimmedId); // Mark ID as processed
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
      resolve({
        results,
        statistics: {
          successCount,
          failedCount,
        },
      });
    }, 1000); // Adjust timeout as needed for CSV processing time
  });
}

function broadcastMatchedITS(matchedITS, location, event) {
  const formattedData = `${matchedITS.id},${matchedITS.name};`; // Format matched ITS data
  location = "AJS";
  event = "AJS";
  // Find clients by location and event
  const targetClients = Array.from(clientsByLocationAndEvent.entries())
    .filter(([key, _]) => key === `${location}_${event}`) // Find matching location and event
    .flatMap(([_, clientsSet]) => Array.from(clientsSet.connections)); // Get all WebSocket connections

  const userIds = []; // To track which userIds received the broadcast

  targetClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) { // Ensure the WebSocket is open
      client.send(formattedData); // Send to the clients
      userIds.push(client.userId); // Add userId to the list
    }
  });

  console.log(`Broadcasted matched ITS to clients at location: ${location}, event: ${event}, User IDs: ${userIds.join(', ')}`);
}

app.get('/health-check', (req, res) => {
  res.status(200).send('OK');
});

//FIND ITS SCANNED DATA
app.post('/lookupITS', async (req, res) => {
  try {
    const { itsId, miqaatId, memberId, gateId, Time_stamp } = req.body; // Extract itsId, location, and event from the request body

     const location = "AJS";
     const event = "AJS";
    // Validate the received data
    // if (!itsId || !location || !event) {
    //   res.status(400).json({ error: 'Missing required fields: itsId, location, or event' });
    //   return; // Early return if validation fails
    // }
    console.log(`Looking up ITS: ${itsId}, Location: ${location}, Event: ${event}`);

    // Perform ITS lookup with additional context

    const { results, statistics } = await lookupITS(itsId, location, event);
    console.log(statistics);
    results.forEach((result, index) => {
      const query = 'INSERT INTO its_scanning_app.ScannedDataShort (ITS_ID, Full_Name, Gate_ID, Seat_Number, Gender, Member_ID, Miqaat_ID) VALUES (?, ?, ?, ?, ?, ?, ?)';
      connection.query(query, [result.id, result.name, gateId, result.seat_name, result.gender, memberId, miqaatId], (err, result) => {
        if (err) {
          console.error('Error inserting scanned data short:', err);
        }
        console.log('Scanned data short inserted successfully')
      });
    });
    // Send the results and statistics back to the client
    res.status(200).json({ results, statistics }); // Combining results and statistics in one JSON object
  } catch (error) {
    console.error('Error looking up ITS:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve static files from a specific folder, e.g., 'public'
app.use('/downloads', express.static(path.join(__dirname, 'public')));

// Additional endpoint to download Excel files
app.get('/downloadExcel/:tableName', (req, res) => {
    const { tableName } = req.params;
    const fileDirectory = path.join(__dirname, 'public');
    const filePath = path.join(fileDirectory, `${tableName}.xlsx`);
    console.log(filePath);
    res.download(filePath, `${tableName}.xlsx`, (err) => {
        if (err) {
            // Handle error, but don't necessarily expose this to the client
            res.status(500).send("Error downloading file.");
        }
    });
});

//EXPORT DATA
app.post('/moveMiqaatData', (req, res) => {
  const { tableName, miqaatId } = req.body;
  if (!tableName || !miqaatId) {
      return res.status(400).send('Missing tableName or miqaatId');
  }

  exportMiqaatData(tableName, miqaatId, (error) => {
    if (error) {
      return res.status(500).send('Failed to move data: ' + error);
    }
    res.send('Data moved successfully');
  });
});

function exportMiqaatData(tableName, miqaatId, callback) {
  const createTableQuery = `
      CREATE TABLE IF NOT EXISTS \`${tableName}\` (
          ITS_ID INT,
          Full_Name VARCHAR(255),
          Gate VARCHAR(255),
          Seat_Number VARCHAR(255),
          Gender VARCHAR(10),
          Scanner_ITS INT,
          Scanner_Name VARCHAR(255),
          Scanned_Time DATETIME,
          Miqaat_name VARCHAR(255)
      );
  `;

  connection.query(createTableQuery, (err, result) => {
      if (err) {
          console.error('Error creating table:', err);
          return callback(err);
      }
      console.log('Table created successfully or already exists.');

      const insertDataQuery = `
          INSERT INTO \`${tableName}\` (ITS_ID, Full_Name, Gate, Seat_Number, Gender, Scanner_ITS, Scanner_Name, Scanned_Time, Miqaat_name)
          SELECT
              SDS.ITS_ID,
              SDS.Full_Name,
              G.Gate_Name,
              SDS.Seat_Number,
              SDS.Gender,
              SDS.its_id AS Scanner_ITS,
              M.name AS Scanner_Name,
              SDS.Scanned_Time,
              MQ.miqaat_name
          FROM
              ScannedDataShort SDS
              LEFT JOIN Gates G ON SDS.Gate_ID = G.gate_id
              LEFT JOIN Members M ON SDS.Member_ID = M.member_id
              LEFT JOIN Miqaats MQ ON SDS.Miqaat_ID = MQ.miqaat_id
          WHERE
              MQ.miqaat_id = ${mysql.escape(miqaatId)};
      `;

      connection.query(insertDataQuery, (err, result) => {
          if (err) {
              console.error('Error inserting scanned data:', err);
              return callback(err);
          }
          console.log('Scanned data inserted successfully.');

          const deleteDataQuery = `
              DELETE FROM ScannedDataShort WHERE Miqaat_ID = ${mysql.escape(miqaatId)};
          `;

          connection.query(deleteDataQuery, async (err, result) => {
              if (err) {
                  console.error('Error deleting original data:', err);
                  return callback(err);
              }
              console.log('Original data deleted successfully.');

              // Generate Excel file after successful data manipulation
              try {
                  const workbook = new ExcelJS.Workbook();
                  const worksheet = workbook.addWorksheet('Exported Data');
                  // Define columns here based on your needs
                  worksheet.columns = [
                      { header: 'ITS ID', key: 'ITS_ID', width: 10 },
                      { header: 'Full Name', key: 'Full_Name', width: 30 },
                      { header: 'Gate', key: 'Gate', width: 15 },
                      // Add other columns as needed
                  ];

                  // Fetch the newly inserted data to write to the Excel file
                  const fetchDataQuery = `SELECT ITS_ID, Full_Name, Gate, Seat_Number, Gender, Scanner_ITS, Scanner_Name, Scanned_Time, Miqaat_name FROM \`${tableName}\``;
                  connection.query(fetchDataQuery, async (err, data) => {
                      if (err) {
                          console.error('Error fetching new data for Excel:', err);
                          return callback(err);
                      }
                      // Add data rows to the worksheet
                      worksheet.addRows(data);

                      // Write to a file
                      const filePath = `./public/${tableName}.xlsx`;
                      await workbook.xlsx.writeFile(filePath);
                      console.log('Excel file created successfully.');
                      callback(null, filePath); // Return the file path if needed
                  });
              } catch (excelError) {
                  console.error('Error creating Excel file:', excelError);
                  return callback(excelError);
              }
          });
      });
  });
}



//OFFLINE DATA UPLOAD
app.post('/uploadIds', async (req, res) => {
  try {
    //console.log(req.body.itsIds);
    //console.log(req.body);
    const ids = req.body.itsIds;
    const { miqaatId, memberId, gateId, Time_stamp } = req.body; // Extract itsId, location, and event from the request body
    // This should already be an array if sent correctly
    console.log('Received ITS IDs:', ids);
    // Perform ITS lookup, assuming lookupITS can handle an array of IDs
    const { results, statistics } = await lookupITS(ids);
    console.log(statistics);

    results.forEach((result, index) => {
      const query = 'INSERT INTO its_scanning_app.ScannedDataShort (ITS_ID, Full_Name, Gate_ID, Seat_Number, Gender, Member_ID, Miqaat_ID) VALUES (?, ?, ?, ?, ?, ?, ?)';
      connection.query(query, [result.id, result.name, gateId, result.seat_name, result.gender, memberId, miqaatId], (err, result) => {
        if (err) {
          console.error('Error inserting scanned data short:', err);
        }
        console.log('Scanned data short inserted successfully')
      });
    });
    // Send the results and statistics back to the client
    res.status(200).json({ results, statistics });
  } catch (error) {
    console.error('Error processing ITS IDs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

//REGISTER USER
app.post('/register', async (req, res) => {
  let { its_id, name, password, role, mohalla_id, designation } = req.body;
  password = its_id;

  // No hashing, store password as plain text (NOT recommended for production)
  const query = 'INSERT INTO Members (its_id, name, password, role, mohalla_id, designation) VALUES (?, ?, ?, ?, ?, ?)';

  connection.query(query, [its_id, name, password, role, mohalla_id, designation], (err, results) => {
    if (err) {
      console.error('Error registering user:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    console.log("User registered successfully");
    res.status(201).json({ message: 'User registered successfully!' });
  });
});

// LOGIN USER
app.post('/login', (req, res) => {
  const { its_id, password } = req.body;

  const query = 'SELECT * FROM Members WHERE its_id = ?';
  connection.query(query, [its_id], (err, results) => {
    if (err) {
      console.error('Error during login:', err);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    if (results.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const user = results[0];
    console.log(user);
    //console.log(user.password);
    // Compare plain-text passwords
    if (password === user.password) {
      // Return entire user object
      res.status(200).json({ message: 'Login successful', user: user });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });
});


// Endpoint to fetch all users
app.get('/users', (req, res) => {
  const query = `
    SELECT Members.*, Mohallas.mohalla_name 
    FROM Members 
    JOIN Mohallas ON Members.mohalla_id = Mohallas.mohalla_id
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching members:', err);
      res.status(500).json({ error: 'Internal server error' });
    } else {
      console.log(results);
      res.status(200).json(results); // Returns members along with their mohalla names
    }
  });
});


// get single user
app.get('/users/:its_id', (req, res) => {
  const its_id = parseInt(req.params.its_id, 10);

  if (isNaN(its_id)) {
    return res.status(400).json({ error: 'Invalid ITS ID' });
  }

  const query = `
    SELECT Members.*, Mohallas.mohalla_name 
    FROM Members 
    JOIN Mohallas ON Members.mohalla_id = Mohallas.mohalla_id 
    WHERE Members.its_id = ?
  `;

  connection.query(query, [its_id], (err, results) => {
    if (err) {
      console.error('Error fetching member:', err);
      res.status(500).json({ error: 'Internal server error' });
    } else if (results.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    } else {
      res.status(200).json(results[0]); // Return the member with the mohalla name
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

  const query = `UPDATE Members SET ${updateFields.join(', ')} WHERE its_id = ?`;
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

  const query = 'DELETE FROM Members WHERE its_id = ?';
  connection.query(query, [its_id], (err, results) => {
    if (err) {
      console.error('Error deleting user:', err);
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.status(200).json({ message: 'User deleted successfully!' });
    }
  });
});

// CRUD Operations for Miqaat

// CREATE Miqaat
app.post('/miqaat', (req, res) => {
  const { miqaat_name, miqaat_date, status } = req.body;

  if (!miqaat_name || !miqaat_date) {
    return res.status(400).json({ error: 'Miqaat name and date are required' });
  }

  const query = 'INSERT INTO Miqaats (miqaat_name, miqaat_date, status) VALUES (?, ?, ?)';
  connection.query(query, [miqaat_name, miqaat_date, status], (err, result) => {
    if (err) {
      console.error('Error inserting miqaat:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    res.status(201).json({ message: 'Miqaat created successfully', miqaat_id: result.insertId });
  });
});


// READ All Miqaat
app.get('/miqaat', (req, res) => {
  const query = 'SELECT * FROM Miqaats';

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching miqaats:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    res.status(200).json(results); // Return all miqaats
  });
});


// READ Single Miqaat by ID
app.get('/miqaat/:id', (req, res) => {
  const miqaat_id = parseInt(req.params.id, 10);

  if (isNaN(miqaat_id)) {
    return res.status(400).json({ error: 'Invalid miqaat ID' });
  }

  const query = 'SELECT * FROM Miqaats WHERE miqaat_id = ?';
  connection.query(query, [miqaat_id], (err, result) => {
    if (err) {
      console.error('Error fetching miqaat:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (result.length === 0) {
      return res.status(404).json({ error: 'Miqaat not found' });
    }

    res.status(200).json(result[0]); // Return the miqaat
  });
});


// UPDATE Miqaat by ID
app.put('/miqaat/:id', (req, res) => {
  const miqaat_id = parseInt(req.params.id, 10);
  const { miqaat_name, miqaat_date, status } = req.body;

  if (isNaN(miqaat_id)) {
    return res.status(400).json({ error: 'Invalid miqaat ID' });
  }

  let updateFields = [];
  let values = [];

  if (miqaat_name) {
    updateFields.push('miqaat_name = ?');
    values.push(miqaat_name);
  }

  if (miqaat_date) {
    updateFields.push('miqaat_date = ?');
    values.push(miqaat_date);
  }

  if (status) {
    updateFields.push('status = ?');
    values.push(status);
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const query = `UPDATE Miqaats SET ${updateFields.join(', ')} WHERE miqaat_id = ?`;
  values.push(miqaat_id);

  connection.query(query, values, (err, result) => {
    if (err) {
      console.error('Error updating miqaat:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    res.status(200).json({ message: 'Miqaat updated successfully' });
  });
});


// DELETE Miqaat by ID
app.delete('/miqaat/:id', (req, res) => {
  const miqaat_id = parseInt(req.params.id, 10);

  if (isNaN(miqaat_id)) {
    return res.status(400).json({ error: 'Invalid miqaat ID' });
  }

  const query = 'DELETE FROM Miqaats WHERE miqaat_id = ?';
  connection.query(query, [miqaat_id], (err, result) => {
    if (err) {
      console.error('Error deleting miqaat:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Miqaat not found' });
    }

    res.status(200).json({ message: 'Miqaat deleted successfully' });
  });
});

// Fetch all Mohallas
app.get('/mohallas', (req, res) => {
  const query = 'SELECT * FROM Mohallas'; // Assuming "Mohallas" is the name of the table

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching mohallas:', err);
      res.status(500).json({ error: 'Internal server error' });
    } else {
      console.log(results);
      res.status(200).json(results); // Return all mohallas
    }
  });
});


// Route to assign members to a miqaat
app.post('/assign-members', (req, res) => {
  const { miqaatName, memberIds } = req.body;

  if (!miqaatName || !Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: 'Invalid request data' });
  }

  const query = 'SELECT miqaat_id FROM Miqaats WHERE miqaat_name = ?';
  connection.query(query, [miqaatName], (err, result) => {
    if (err) {
      console.error('Error fetching miqaat:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (result.length === 0) {
      return res.status(404).json({ error: 'Miqaat not found' });
    }

    const miqaatId = result[0].miqaat_id;

    // Insert selected member IDs into MiqaatMembers
    const insertQuery = 'INSERT INTO MiqaatMembers (miqaat_id, member_id) VALUES (?, ?)';
    const insertOperations = memberIds.map((memberId) => {
      return new Promise((resolve, reject) => {
        connection.query(insertQuery, [miqaatId, memberId], (err, result) => {
          if (err) {
            return reject(err);
          }
          resolve(result);
        });
      });
    });

    Promise.all(insertOperations)
      .then(() => res.status(200).json({ message: 'Members assigned to miqaat successfully' }))
      .catch((error) => {
        console.error('Error assigning members to miqaat:', error);
        res.status(500).json({ error: 'Internal server error' });
      });
  });
});

//CRUD GATES

// CREATE Gate
app.post('/gates', (req, res) => {
  const { gate_name, mohalla_id } = req.body;

  if (!gate_name || !mohalla_id) {
    return res.status(400).json({ error: 'Gate name and Mohalla ID are required' });
  }

  const query = 'INSERT INTO Gates (gate_name, mohalla_id) VALUES (?, ?)';
  connection.query(query, [gate_name, mohalla_id], (err, result) => {
    if (err) {
      console.error('Error creating gate:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    res.status(201).json({ message: 'Gate created successfully', gate_id: result.insertId });
  });
});

// READ All Gates
app.get('/gates', (req, res) => {
  const query = 'SELECT * FROM Gates';
  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching gates:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    res.status(200).json(results);
  });
});

// READ Single Gate by ID
app.get('/gates/:gate_id', (req, res) => {
  const gate_id = parseInt(req.params.gate_id);

  if (isNaN(gate_id)) {
    return res.status(400).json({ error: 'Invalid gate ID' });
  }

  const query = 'SELECT * FROM Gates WHERE gate_id = ?';
  connection.query(query, [gate_id], (err, results) => {
    if (err) {
      console.error('Error fetching gate:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Gate not found' });
    }

    res.status(200).json(results[0]);
  });
});

// UPDATE Gate by ID
app.put('/gates/:gate_id', (req, res) => {
  const gate_id = parseInt(req.params.gate_id);
  const { gate_name, mohalla_id } = req.body;

  if (isNaN(gate_id)) {
    return res.status(400).json({ error: 'Invalid gate ID' });
  }

  const query = 'UPDATE Gates SET gate_name = ?, mohalla_id = ? WHERE gate_id = ?';
  connection.query(query, [gate_name, mohalla_id, gate_id], (err, results) => {
    if (err) {
      console.error('Error updating gate:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    res.status(200).json({ message: 'Gate updated successfully' });
  });
});

// DELETE Gate by ID
app.delete('/gates/:gate_id', (req, res) => {
  const gate_id = parseInt(req.params.gate_id);

  if (isNaN(gate_id)) {
    return res.status(400).json({ error: 'Invalid gate ID' });
  }

  const query = 'DELETE FROM Gates WHERE gate_id = ?';
  connection.query(query, [gate_id], (err, results) => {
    if (err) {
      console.error('Error deleting gate:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    res.status(200).json({ message: 'Gate deleted successfully' });
  });
});

//list of IDS
app.post('/fetch-users-by-ids', (req, res) => {
  const { memberIds } = req.body; // Extract the list of member IDs from the request

  // Query to fetch users by a list of IDs
  const query = `SELECT * FROM Members WHERE member_id IN (${memberIds.join(',')})`;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching users by IDs:', err);
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.status(200).json(results); // Return the fetched user data
    }
  });
});

// Create a new gate assignment
app.post('/gate-assignments', (req, res) => {
  const { gate_id, miqaat_id, member_id } = req.body;

  // Validate input data
  if (!gate_id || !miqaat_id || !member_id) {
    return res.status(400).json({ error: 'Missing required fields: gate_id, miqaat_id, member_id' });
  }
  console.log("hi");
  const query = 'INSERT INTO GateAssignments (gate_id, miqaat_id, member_id) VALUES (?, ?, ?)';
  connection.query(query, [gate_id, miqaat_id, member_id], (err, result) => {
    if (err) {
      console.error('Error creating gate assignment:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.status(201).json({ message: 'Gate assignment created successfully', gate_assignment_id: result.insertId });
  });
});

app.get('/fetch-gate-assignments/:eventId', (req, res) => {
  const eventId = parseInt(req.params.eventId);

  if (isNaN(eventId)) {
    return res.status(400).json({ error: 'Invalid event ID' });
  }

  const query = 'SELECT * FROM GateAssignments WHERE miqaat_id = ?';

  connection.query(query, [eventId], (err, results) => {
    if (err) {
      console.error('Error fetching gate assignments:', err);
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.status(200).json(results); // Return all gate assignments for the event
    }
  });
});

// // GET API to fetch miqaat names assigned to each member
// app.get('/miqaats_for_user/:memberId', (req, res) => {
//   console.log("HERE");
//   const memberId = parseInt(req.params.memberId);

//   if (isNaN(memberId)) {
//     return res.status(400).json({ error: 'Invalid member ID' });
//   }

//   const query = `
//     SELECT m.miqaat_id, m.miqaat_name, m.miqaat_date
//     FROM Miqaats m
//     JOIN MiqaatMembers mm ON m.miqaat_id = mm.miqaat_id
//     WHERE mm.member_id = ?;
//   `;

//   connection.query(query, [memberId], (err, results) => {
//     if (err) {
//       console.error('Error fetching miqaats:', err);
//       return res.status(500).json({ error: 'Internal server error' });
//     }
//     //console.log(json(results));
//     console.log(results);
//     res.status(200).json(results); // Return all miqaats assigned to the member
//   });
// });

// GET API to fetch miqaat names assigned to each member using GateAssignments
app.get('/miqaats_for_user/:memberId', (req, res) => {
  console.log("API Call: Fetch Miqaats for User based on Gate Assignments");
  const memberId = parseInt(req.params.memberId);

  if (isNaN(memberId)) {
    console.log("Invalid member ID provided");
    return res.status(400).json({ error: 'Invalid member ID' });
  }

  // This query joins Miqaats and GateAssignments and selects unique Miqaats for the given member
  const query = `
    SELECT DISTINCT m.miqaat_id, m.miqaat_name, m.miqaat_date
    FROM Miqaats m
    JOIN GateAssignments ga ON m.miqaat_id = ga.miqaat_id
    WHERE ga.member_id = ?
    ORDER BY m.miqaat_date;
  `;

  connection.query(query, [memberId], (err, results) => {
    if (err) {
      console.error('Error fetching miqaats based on gate assignments:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    console.log("Sending Miqaats Data based on Gate Assignments:", JSON.stringify(results, null, 2));
    res.status(200).json(results); // Return all unique miqaats assigned to the member through gate assignments
  });
});

app.get('/gates_for_user/:miqaatId/:memberId', (req, res) => {
  const miqaatId = parseInt(req.params.miqaatId);
  const memberId = parseInt(req.params.memberId);

  if (isNaN(miqaatId) || isNaN(memberId)) {
    return res.status(400).json({ error: 'Invalid miqaat ID or member ID' });
  }

  const query = `
    SELECT g.gate_id, g.gate_name
    FROM Gates g
    JOIN GateAssignments ga ON g.gate_id = ga.gate_id
    WHERE ga.miqaat_id = ? AND ga.member_id = ?;
  `;

  connection.query(query, [miqaatId, memberId], (err, results) => {
    if (err) {
      console.error('Error fetching gates:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.status(200).json(results); // Return all gates for the selected miqaat and member
  });
});

// Insert ScannedDataShort
app.post('/insert-scanned-data-short', (req, res) => {
  const { itsId, fullName, gateId, seatNumber, gender, memberId, miqaatId } = req.body;

  const query = 'INSERT INTO its_scanning_app.ScannedDataShort (ITS_ID, Full_Name, Gate_ID, Seat_Number, Gender, Member_ID, Miqaat_ID) VALUES (?, ?, ?, ?, ?, ?, ?)';
  connection.query(query, [itsId, fullName, gateId, seatNumber, gender, memberId, miqaatId], (err, result) => {
    if (err) {
      console.error('Error inserting scanned data short:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.status(200).json({ message: 'Scanned data short inserted successfully' });
  });
});

const port = 8080;
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
