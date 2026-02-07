// Password protection
const CORRECT_PASSWORD = '8888';
const SESSION_KEY = 'community_auth';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

function checkAuth() {
    const auth = localStorage.getItem(SESSION_KEY);
    if (auth) {
        const authData = JSON.parse(auth);
        if (Date.now() - authData.timestamp < SESSION_DURATION) {
            showMainApp();
            return;
        }
    }
    showLoginScreen();
}

function showLoginScreen() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    
    document.getElementById('loginButton').onclick = function() {
        const password = document.getElementById('passwordInput').value;
        if (password === CORRECT_PASSWORD) {
            localStorage.setItem(SESSION_KEY, JSON.stringify({
                timestamp: Date.now()
            }));
            showMainApp();
        } else {
            document.getElementById('loginError').style.display = 'block';
        }
    };
    
    document.getElementById('passwordInput').onkeypress = function(e) {
        if (e.key === 'Enter') {
            document.getElementById('loginButton').click();
        }
    };
}

function showMainApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
}

// Check auth on page load
checkAuth();

// ===== EXISTING APP FUNCTIONALITY =====

let map;
let markers = [];
let isListening = false;
let recognition;

// Initialize voice recognition
if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    
    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        document.getElementById('searchInput').value = transcript;
        performSearch();
    };
    
    recognition.onend = function() {
        isListening = false;
        document.getElementById('micButton').classList.remove('listening');
    };
    
    recognition.onerror = function(event) {
        console.error('Speech recognition error:', event.error);
        isListening = false;
        document.getElementById('micButton').classList.remove('listening');
    };
}

function toggleVoiceSearch() {
    if (!recognition) {
        alert('Voice search is not supported in your browser');
        return;
    }
    
    if (isListening) {
        recognition.stop();
        isListening = false;
        document.getElementById('micButton').classList.remove('listening');
    } else {
        recognition.start();
        isListening = true;
        document.getElementById('micButton').classList.add('listening');
    }
}

function getSessionId() {
    let sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
        sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('sessionId', sessionId);
    }
    return sessionId;
}

function newSession() {
    localStorage.removeItem('sessionId');
    document.getElementById('response').innerHTML = '';
    document.getElementById('response').classList.remove('show');
    document.getElementById('map').classList.remove('show');
    document.getElementById('searchInput').value = '';
    if (map) {
        markers.forEach(marker => marker.remove());
        markers = [];
    }
}

async function performSearch() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) return;

    const responseDiv = document.getElementById('response');
    responseDiv.innerHTML = '<div class="loading">🔍 Searching The Community...</div>';
    responseDiv.classList.add('show');
    
    document.getElementById('map').classList.remove('show');
    if (map) {
        markers.forEach(marker => marker.remove());
        markers = [];
    }

    try {
        const sessionId = getSessionId();
        
        const response = await fetch('https://stanleymak.app.n8n.cloud/webhook/c75eb326-3d83-4ea5-8e01-5dab92e561fc', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: query,
                session_id: sessionId,
                timestamp: new Date().toISOString()
            })
        });

        if (!response.ok) {
            throw new Error('Search failed');
        }

        const data = await response.json();
        
        if (data.conversational_response) {
            responseDiv.innerHTML = data.conversational_response.replace(/\n/g, '<br>');
        }

        if (data.locations && data.locations.length > 0) {
            displayMap(data.locations);
        }

    } catch (error) {
        console.error('Search error:', error);
        responseDiv.innerHTML = '<div class="error">😔 Sorry, something went wrong. Please try again.</div>';
    }
}

function displayMap(locations) {
    const mapDiv = document.getElementById('map');
    mapDiv.classList.add('show');

    if (!map) {
        map = L.map('map');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
    }

    markers.forEach(marker => marker.remove());
    markers = [];

    const bounds = [];
    
    locations.forEach((location, index) => {
        if (location.latitude && location.longitude) {
            const marker = L.marker([location.latitude, location.longitude])
                .addTo(map)
                .bindPopup(`
                    <strong>${location.name}</strong><br>
                    ${location.distance ? location.distance + ' away<br>' : ''}
                    ${location.personal_note ? '<em>' + location.personal_note + '</em>' : ''}
                `);
            
            markers.push(marker);
            bounds.push([location.latitude, location.longitude]);
        }
    });

    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}