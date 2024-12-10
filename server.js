
const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const { Client } = require('pg');
const cors = require('cors');
const path = require('path');
const http = require('http');
const router = express.Router();
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
const port = process.env.PORT || 10000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());


const db = new Client({
  connectionString: "postgresql://opdmsis_user:3sc6VNaexgXhje2UgoQ4fnvPf8x1KDGG@dpg-ct2lk83qf0us739u2uvg-a/opdmsis",
  ssl: {
    rejectUnauthorized: false, // This is to handle SSL certificates for the hosted database
  }
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to PostgreSQL:', err);
    process.exit(1);
  }
  console.log('PostgreSQL connected...');
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    const query = `
        SELECT * 
        FROM patient_info 
        WHERE 
            (username = $1 
             OR email = $1 
             OR TRIM(CONCAT_WS(' ', SPLIT_PART(name, ' ', 1), SPLIT_PART(name, ' ', 2))) = $1) 
            AND password = $2
    `;

    db.query(query, [username, password], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Server error');
        }

        if (result.rows.length > 0) {
            res.json({ success: true, username: result.rows[0].username });
        } else {
            res.json({ success: false, message: 'Invalid credentials' });
        }
    });
});

app.post('/forgot-password', (req, res) => {
    const { email, name } = req.body;

    if (!email || !name) {
        return res.status(400).json({ success: false, message: 'Email and name are required.' });
    }

    const checkUserQuery = 'SELECT * FROM patient_info WHERE email = $1 AND name = $2';

    db.query(checkUserQuery, [email, name], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }

        if (result.rows.length === 0) {
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
            return res.status(200).json({ success: true, message: 'OTP sent, don\'t share it with anyone!' });
        });
    });
});


app.post('/verify-otp', (req, res) => {
    const { email, name, otp, newPassword } = req.body;

    if (!email || !name || !otp || !newPassword) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    try {
        // Verify OTP
        if (!otpStore[email]) {
            return res.status(400).json({ success: false, message: 'OTP not found. Please request a new one.' });
        }

        if (otpStore[email] !== parseInt(otp)) {
            return res.status(400).json({ success: false, message: 'Invalid OTP.' });
        }

        // Remove OTP after successful validation
        delete otpStore[email];

        // Verify email and name in the database
        const checkUserQuery = 'SELECT * FROM patient_info WHERE email = $1 AND name = $2';
        db.query(checkUserQuery, [email, name], (err, result) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ success: false, message: 'Database error.' });
            }

            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Email and name do not match any records.' });
            }

            // Update password
            const updatePasswordQuery = 'UPDATE patient_info SET password = $1 WHERE email = $2 AND name = $3';
            db.query(updatePasswordQuery, [newPassword, email, name], (err, updateResult) => {
                if (err) {
                    console.error('Error updating password:', err);
                    return res.status(500).json({ success: false, message: 'Error updating password.' });
                }

                if (updateResult.rowCount > 0) {
                    return res.json({ success: true, message: 'Password saved successfully. You can now login!' });
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
    const query = 'SELECT * FROM patient_info WHERE username = $1';

    db.query(query, [username], (err, result) => {
        if (err) {
            console.error('Error fetching patient info:', err);
            return res.status(500).send('Server error');
        }

        if (result.rows.length === 0) {
            return res.status(404).send('Patient not found');
        }

        res.json(result.rows[0]);
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
            patient_info.username = $1
        ORDER BY 
            vitalsigns.date_added DESC
        LIMIT 1;  -- Ensures only the latest record is returned
    `;

    db.query(query, [username], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Server error');
        }

        if (result.rows.length > 0) {
            res.json(result.rows[0]);
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
    const startOfYear = new Date(today.getFullYear(), 0, 1); // Start of the year
    const endOfYear = new Date(today.getFullYear() + 1, 0, 0); // End of the year
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1); // Start of the month
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0); // End of the month
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // Start of the day

    let dateFilterStart;
    let dateFilterEnd = today; // Default end date is today

    // Adjust for the filter option
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
            patient_info.username = $1
    `;

    // Add date filters if applicable
    const params = [username];
    if (dateFilterStart && dateFilterEnd) {
        query += ` AND vitalsigns.date_added >= $2 AND vitalsigns.date_added <= $3`;
        params.push(dateFilterStart, dateFilterEnd);
    }

    query += ` ORDER BY vitalsigns.date_added DESC`;

    // Query the database
    db.query(query, params, (err, result) => {
        if (err) {
            console.error('Database query error:', err);
            return res.status(500).send('Server error');
        }

        if (result.rows.length > 0) {
            return res.json(result.rows);
        } else {
            return res.json([]); // Return an empty array instead of a 404 error
        }
    });
});

// Fetch Announcements (ordered by date)
app.get('/announcements', (req, res) => {
    const query = 'SELECT * FROM announcement ORDER BY date DESC';

    db.query(query, (err, result) => {
        if (err) {
            console.error('Error fetching announcements:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.json(result.rows);
    });
});

// Fetch Treatment with Diagnosis and apply filters (today, this month, this year, or all)
app.get('/treatment', (req, res) => {
    const { username, filter } = req.query;

    if (!username) {
        return res.status(400).send('Username is required');
    }

    // Define the filter conditions for today, this month, this year
    let dateCondition = '';
    const currentDate = new Date();
    const startOfDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()); // Start of today
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1); // Start of this month
    const startOfYear = new Date(currentDate.getFullYear(), 0, 1); // Start of this year

    // Build date condition based on the filter
    if (filter === 'today') {
        dateCondition = ` AND dc.date_created >= $2`;
    } else if (filter === 'thisMonth') {
        dateCondition = ` AND dc.date_created >= $2`;
    } else if (filter === 'thisYear') {
        dateCondition = ` AND dc.date_created >= $2`;
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
            dc.username = p.username
        WHERE 
            dc.username = $1 ${dateCondition}
        ORDER BY 
            dc.date_created DESC
    `;

    // Define query parameters
    const params = [username];
    if (filter === 'today') {
        params.push(startOfDay);
    } else if (filter === 'thisMonth') {
        params.push(startOfMonth);
    } else if (filter === 'thisYear') {
        params.push(startOfYear);
    }

    // Execute the query
    db.query(query, params, (err, result) => {
        if (err) {
            console.error('Error fetching treatment and diagnosis:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.json(result.rows);
    });
});

app.get('/prescription-history', (req, res) => {
    const { username, filter } = req.query;

    if (!username) {
        return res.status(400).send('Username is required');
    }

    let query = `
        SELECT *
        FROM doctor_confirm
        WHERE username = $1
    `;
    
    // Add filtering logic based on the filter parameter
    if (filter === 'today') {
        query += ` AND date_trunc('day', date_created) = date_trunc('day', CURRENT_DATE)`;
    } else if (filter === 'this_month') {
        query += ` AND date_trunc('month', date_created) = date_trunc('month', CURRENT_DATE)`;
    } else if (filter === 'this_year') {
        query += ` AND date_trunc('year', date_created) = date_trunc('year', CURRENT_DATE)`;
    }

    query += ` ORDER BY date_created DESC`; // Order by latest records

    db.query(query, [username], (err, result) => {
        if (err) {
            console.error('Error fetching prescription history:', err);
            return res.status(500).send('Server error');
        }
        res.json(result.rows);
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
    const getDateCreatedQuery = 'SELECT date_created FROM patient_info WHERE username = $1';
    db.query(getDateCreatedQuery, [username], (err, result) => {
        if (err) {
            console.error('Error fetching date_created:', err);
            return res.status(500).json({ success: false, message: 'Server error' });
        }
        
        const dateCreated = result.rows[0]?.date_created;

        // Update the patient information
        const updateQuery = `
        UPDATE patient_info SET
            email = $1, 
            name = $2, 
            guardian = $3, 
            address = $4, 
            contactnum = $5, 
            age = $6, 
            sex = $7, 
            civil_status = $8, 
            dob = $9
        WHERE username = $10`;

        db.query(updateQuery, [email, name, guardian, address, contactnum, age, sex, civil_status, dob, username], (err, result) => {
            if (err) {
                console.error('Error updating patient info:', err);
                return res.status(500).json({ success: false, message: 'Server error' });
            }

            // Restore the original date_created value
            const restoreDateQuery = 'UPDATE patient_info SET date_created = $1 WHERE username = $2';
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

    const query = 'SELECT * FROM patient_info WHERE username = $1';

    db.query(query, [username], (err, result) => {
        if (err) {
            console.error('Error fetching patient data:', err);
            return res.status(500).json({ success: false, message: 'Server error' });
        }

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Patient not found' });
        }

        return res.status(200).json({ success: true, data: result.rows[0] });
    });
});

