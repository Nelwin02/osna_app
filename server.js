
const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// In-memory store for OTPs
let otpStore = {};
// Setup Nodemailer transporter
const transporter = nodemailer.createTransport({
    service: 'gmail', // or any other email service
    auth: {
        user: 'osnanotify@gmail.com', // Replace with your email
        pass: 'eynrorlknfmjcktr'  // Replace with your email password or an app password
    }
});

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(cors());

// MySQL Database Connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'opdmsis'
});

db.connect(err => {
    if (err) {
        console.error('Error connecting to the database:', err);
        return;
    }
    console.log('Connected to the database');
});

app.post('/login', (req, res) => {
    const { username, password } = req.body; // Accept username, name, or email in 'username'
    const query = `
        SELECT * 
        FROM patient_info 
        WHERE 
            (username = ? 
             OR email = ? 
             OR TRIM(CONCAT(SUBSTRING_INDEX(name, ' ', 1), ' ', SUBSTRING_INDEX(SUBSTRING_INDEX(name, ' ', -2), ' ', 1))) = ?) 
            AND password = ?
    `;
    db.query(query, [username, username, username, password], (err, results) => {
        if (err) {
            return res.status(500).send('Server error');
        }
        if (results.length > 0) {
            res.json({ success: true, username: results[0].username });
        } else {
            res.json({ success: false, message: 'Invalid credentials' });
        }
    });
});

app.post('/forgot-password', async (req, res) => {
    const { email, name } = req.body;

    if (!email || !name) {
        return res.status(400).json({ success: false, message: 'Email and name are required.' });
    }

    try {
        // Check if the email and name exist in the database
        const checkUserQuery = 'SELECT * FROM patient_info WHERE email = ? AND name = ?';
        db.query(checkUserQuery, [email, name], (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ success: false, message: 'Database error.' });
            }

            if (results.length === 0) {
                // No matching record found, respond with a specific message
                return res.status(200).json({
                    success: false,
                    message: 'The provided email and name do not match our records.',
                });
            }

            // Generate a 6-digit OTP
            const otp = Math.floor(100000 + Math.random() * 900000); // Generates a 6-digit number
            otpStore[email] = otp; // Store OTP temporarily

            // Send OTP via email
            const mailOptions = {
                from: 'osnanotify@gmail.com',
                to: email,
                subject: 'Password Reset OTP',
                text: `Your OTP for password reset is ${otp}. It will expire in 10 minutes.`,
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Error sending OTP email:', error);
                    return res.status(500).json({
                        success: false,
                        message: 'Error sending OTP email. Please try again later.',
                    });
                }
                console.log('OTP sent: ' + info.response);
                return res.status(200).json({ success: true, message: 'OTP sent, dont share to anyone!.' });
            });
        });
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});


// Route to verify OTP and reset the password
app.post('/verify-otp', (req, res) => {
    const { email, name, otp, newPassword } = req.body;

    if (!email || !name || !otp || !newPassword) {
        return res.status(400).json({ success: false, message: 'all field are required.' });
    }

    try {
        // Verify OTP
        if (!otpStore[email]) {
            return res.status(400).json({ success: false, message: 'OTP not found. Please request a new one.' });
        }

        if (otpStore[email] !== parseInt(otp)) {
            return res.status(400).json({ success: false, message: 'Invalid OTP.' });
        }

        // Optionally, set expiration time for OTP validation (e.g., 10 minutes)
        delete otpStore[email]; // Remove OTP after successful validation

        // Verify that the email and name match in the database
        const checkUserQuery = 'SELECT * FROM patient_info WHERE email = ? AND name = ?';
        db.query(checkUserQuery, [email, name], (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ success: false, message: 'Database error.' });
            }

            if (results.length === 0) {
                return res.status(404).json({ success: false, message: 'Email and name do not match any records.' });
            }

            // Update the password
            const updatePasswordQuery = 'UPDATE patient_info SET password = ? WHERE email = ? AND name = ?';
            db.query(updatePasswordQuery, [newPassword, email, name], (err, results) => {
                if (err) {
                    console.error('Error updating password:', err);
                    return res.status(500).json({ success: false, message: 'Error updating password.' });
                }

                if (results.affectedRows > 0) {
                    return res.json({ success: true, message: 'Password save successful, You can Login!.' });
                } else {
                    // This case shouldn't normally happen, as we already checked for the user
                    return res.status(404).json({ success: false, message: 'Failed to update password. User not found.' });
                }
            });
        });
    } catch (error) {
        console.error('Error verifying OTP or updating password:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});



// Get Patient Information by Username
app.get('/patient/:username', (req, res) => {
    const { username } = req.params;
    const query = 'SELECT * FROM patient_info WHERE username = ?';
    db.query(query, [username], (err, results) => {
        if (err) {
            console.error('Error fetching patient info:', err);
            return res.status(500).send('Server error');
        }
        if (results.length === 0) {
            return res.status(404).send('Patient not found');
        }
        res.json(results[0]);
    });
});


// Fetch Patient Info Using Query
app.get('/vital', (req, res) => {
    const { username } = req.query;

    const query = `
       SELECT 
           patient_info.*, 
           vitalsigns.*
       FROM 
           patient_info
       JOIN 
           vitalsigns 
       ON 
           patient_info.username = vitalsigns.username
       WHERE 
           patient_info.username = ?
       ORDER BY 
           vitalsigns.date_added DESC
       LIMIT 1;`;  // This ensures only the latest record is returned

    db.query(query, [username], (err, results) => {
        if (err) {
            return res.status(500).send('Server error');
        }
        if (results.length > 0) {
            res.json(results[0]);
        } else {
            res.status(404).send('User not found');
        }
    });
});


app.get('/patient-info', (req, res) => {
    const { username, filter } = req.query;
  
    if (!username) {
      return res.status(400).send('Username is required');
    }
  
    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 1);  // Start of the year
    const endOfYear = new Date(today.getFullYear() + 1, 0, 0);  // End of the year
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);  // Start of the month
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);  // End of the month
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // Start of the day
  
    let dateFilterStart;
    let dateFilterEnd = today;  // End date is today by default
  
    // Adjust for the filter option: 'All', 'Month', or 'Year', but default to 'Today'
    switch (filter) {
      case 'Month':
        dateFilterStart = startOfMonth;
        dateFilterEnd = endOfMonth;
        break;
      case 'Year':
        dateFilterStart = startOfYear;
        dateFilterEnd = endOfYear;
        break;
      case 'All Months':
      case 'All Years':
        // No date restriction for all months/years
        dateFilterStart = null;
        dateFilterEnd = null;
        break;
      case 'Today':
      default:
        dateFilterStart = startOfDay;
        dateFilterEnd = today;
        break;
    }
  
    let query = `
      SELECT 
          patient_info.*, 
          vitalsigns.* 
      FROM 
          patient_info
      JOIN 
          vitalsigns 
      ON 
          patient_info.username = vitalsigns.username
      WHERE 
          patient_info.username = ?
    `;
    
    // Only add date filters if they are set
    if (dateFilterStart && dateFilterEnd) {
      query += ` AND vitalsigns.date_added >= ? AND vitalsigns.date_added <= ?`;
    }
    
    query += ` ORDER BY vitalsigns.date_added DESC`;
  
    // Query the database
    db.query(query, [username, dateFilterStart, dateFilterEnd].filter(Boolean), (err, results) => {
      if (err) {
        console.error('Database query error:', err);
        return res.status(500).send('Server error');
      }
  
      if (results.length > 0) {
        return res.json(results);
      } else {
        return res.json([]); // Return an empty array instead of a 404 error
      }
    });
  });
  
// Fetch Announcements (ordered by date)
app.get('/announcements', (req, res) => {
    const query = 'SELECT * FROM announcement ORDER BY date DESC';
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching announcements:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.json(results);
    });
});

//fetch treatment 


// Fetch Treatment with Diagnosis and apply filters (today, this month, this year, or all)
app.get('/treatment', (req, res) => {
    const { username, filter } = req.query;
    
    // Define the filter conditions for today, this month, this year
    let dateCondition = '';
    const currentDate = new Date();
    const startOfDay = new Date(currentDate.setHours(0, 0, 0, 0)); // Today
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1); // This month
    const startOfYear = new Date(currentDate.getFullYear(), 0, 1); // This year
    
    // Build date condition based on the filter
    if (filter === 'today') {
        dateCondition = ` AND dc.date_created >= '${startOfDay.toISOString()}'`;
    } else if (filter === 'thisMonth') {
        dateCondition = ` AND dc.date_created >= '${startOfMonth.toISOString()}'`;
    } else if (filter === 'thisYear') {
        dateCondition = ` AND dc.date_created >= '${startOfYear.toISOString()}'`;
    }

    // SQL query to join doctor_confirm with prediction
    const query = `
    SELECT 
        dc.diagnosis, 
        p.predicted_treatment,
        dc.date_created
    FROM 
        doctor_confirm dc
    LEFT JOIN 
        prediction p 
    ON 
        dc.username = p.username  -- Use username as the join condition
    WHERE 
        dc.username = ? ${dateCondition}
    ORDER BY 
        dc.date_created DESC
`;

    
    db.query(query, [username], (err, results) => {
        if (err) {
            console.error('Error fetching treatment and diagnosis:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.json(results);
    });
});

app.get('/prescription-history', (req, res) => {
    const { username, filter } = req.query;
    let query = `
        SELECT *
        FROM doctor_confirm
        WHERE username IN (SELECT username FROM patient_info WHERE username = ?)
    `;
    
    // Add filtering logic based on the filter parameter
    if (filter === 'today') {
        query += ` AND DATE(date_created) = CURDATE()`;
    } else if (filter === 'this_month') {
        query += ` AND MONTH(date_created) = MONTH(CURDATE()) AND YEAR(date_created) = YEAR(CURDATE())`;
    } else if (filter === 'this_year') {
        query += ` AND YEAR(date_created) = YEAR(CURDATE())`;
    }

    db.query(query, [username], (err, results) => {
        if (err) {
            console.error('Error fetching prescription history:', err);
            return res.status(500).send('Server error');
        }
        res.json(results);
    });
});



// Update patient information endpoint
app.post('/update_patient_info', (req, res) => {
    const { username, email, name, guardian, address, contactnum, age, sex, civil_status, dob } = req.body;

    // Validate dob format (YYYY-MM-DD)
    const dobRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dobRegex.test(dob)) {
        return res.status(400).json({ success: false, message: 'Invalid DOB format. Use YYYY-MM-DD.' });
    }

    // Fetch current date_created value
    const getDateCreatedQuery = 'SELECT date_created FROM patient_info WHERE username = ?';
    db.query(getDateCreatedQuery, [username], (err, result) => {
        if (err) {
            console.error('Error fetching date_created:', err);
            return res.status(500).json({ success: false, message: 'Server error' });
        }
        
        const dateCreated = result[0]?.date_created;

        // Update the patient information
        const updateQuery = `
        UPDATE patient_info SET
            email = ?, 
            name = ?, 
            guardian = ?, 
            address = ?, 
            contactnum = ?, 
            age = ?, 
            sex = ?, 
            civil_status = ?, 
            dob = ?
        WHERE username = ?`;

        db.query(updateQuery, [email, name, guardian, address, contactnum, age, sex, civil_status, dob, username], (err, result) => {
            if (err) {
                console.error('Error updating patient info:', err);
                return res.status(500).json({ success: false, message: 'Server error' });
            }

            // Restore the original date_created value
            const restoreDateQuery = 'UPDATE patient_info SET date_created = ? WHERE username = ?';
            db.query(restoreDateQuery, [dateCreated, username], (restoreErr, restoreResult) => {
                if (restoreErr) {
                    console.error('Error restoring date_created:', restoreErr);
                    return res.status(500).json({ success: false, message: 'Server error' });
                }
                return res.status(200).json({ success: true, message: 'Patient information updated successfully' });
            });
        });
    });
});

// Get patient information by username
app.get('/get_patient_info', (req, res) => {
    const { username } = req.query;
    
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required' });
    }

    const query = 'SELECT * FROM patient_info WHERE username = ?';
    
    db.query(query, [username], (err, result) => {
        if (err) {
            console.error('Error fetching patient data:', err);
            return res.status(500).json({ success: false, message: 'Server error' });
        }

        if (result.length === 0) {
            return res.status(404).json({ success: false, message: 'Patient not found' });
        }

        return res.status(200).json({ success: true, data: result[0] });
    });
});








// Server Listening on Port
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
