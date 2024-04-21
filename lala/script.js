
const socket = io('192.168.18.108:8080');
const resultList = new Set(); // Using a Set to avoid duplicate entries

const clientId = Date.now().toString(); // Example: using timestamp for simplicity, consider a better unique identifier
function showLoading() {
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}
socket.on('update', function (data) {
    data.forEach(entry => {
        if (!resultList.has(entry.itsId)) {
            resultList.add(entry.itsId);
            updateList(entry.itsId, entry.name);
        }
    });
});

socket.on('delete', function(itsId) {
    deleteITS(itsId); // Adjust this function as needed

    // If using local storage to track state, update it here
    if (window.localStorage) {
        let storedResults = loadLocalData(); // Assuming a function to load data
        storedResults = storedResults.filter(item => item.itsId !== itsId);
        localStorage.setItem('pendingITSIDs', JSON.stringify(storedResults));
    }
});



function updateList(itsId, name) {
    const list = document.getElementById('resultList');
    let listItem = document.querySelector(`li[data-itsid="${itsId}"]`);
    let textSpan, deleteIcon;

    if (!listItem) {
        // Create the list item if it doesn't exist
        listItem = document.createElement('li');
        listItem.setAttribute('data-itsid', itsId);
        
        // Create and append the text span
        textSpan = document.createElement('span');
        listItem.appendChild(textSpan);

        // Create and append the delete icon
        deleteIcon = document.createElement('span');
        deleteIcon.innerHTML = '&times;';  // Using &times; for a 'cross' symbol
        deleteIcon.classList.add('delete-icon');
        deleteIcon.onclick = function() { deleteITS(itsId); };
        listItem.appendChild(deleteIcon);

        // Append the whole item to the list
        list.appendChild(listItem);
    } else {
        // Access the existing elements
        textSpan = listItem.querySelector('span:first-child');
        deleteIcon = listItem.querySelector('.delete-icon');
    }

    // Update the text content
    textSpan.textContent = `${itsId} - ${name}`;

    // Update the total count
    const totalCountElement = document.getElementById('totalCount');
    totalCountElement.textContent = resultList.size;
}


document.getElementById('itsIdInput').addEventListener('input', function () {
    const value = this.value;
    if (value.length === 8 && /^\d{8}$/.test(value)) {
        this.value = ''; // Clear the input immediately after processing
        if (!resultList.has(value)) {
            lookupITSID(value);
            document.getElementById('result').textContent = ''; // Clear any previous error message
        } else {
            document.getElementById('result').textContent = 'Already marked scan';
        }
    }
});

function lookupITSID(itsId) {
    showLoading();

    if (navigator.onLine) {
        fetch('/lookup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ itsId, clientId }) // Send clientId with the request
        })
            .then(response => {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.json();
            })
            .then(data => {
                hideLoading();
                if (data.name) {
                    resultList.add(itsId); // Add to Set to track it has been marked
                    updateList(itsId, data.name);
                } else {
                    document.getElementById('result').textContent = 'Data not found';
                }
            })
            .catch(error => {
                console.error('Error:', error);
                document.getElementById('result').textContent = 'Error fetching data.';
                hideLoading();
            });
    } else {
        const pendingData = loadLocalData();
        pendingData.push({ itsId: itsId, clientId: clientId });
        saveLocally(pendingData);
        console.log('Stored ITS ID locally due to no internet connection.');
        document.getElementById('network-status').textContent = 'Offline - Data saved locally';
        hideLoading();
    }
}

document.getElementById('exportButton').addEventListener('click', function () {
    const data = Array.from(resultList).map(itsId => {
        // Retrieve the list item using the data-itsid attribute
        const entry = document.querySelector(`li[data-itsid="${itsId}"]`);
        const parts = entry ? entry.textContent.split(' - ') : ['Unknown', 'Unknown'];
        return { ITS_ID: parts[0], Name: parts[1] };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "ITS_IDs");

    // Download the file
    XLSX.writeFile(workbook, 'ITS_IDs.xlsx');
});

// Check if the browser supports localStorage
if (window.localStorage) {
    // Function to save data locally
    function saveLocally(data) {
        localStorage.setItem('pendingITSIDs', JSON.stringify(data));
    }

    // Function to load locally stored data
    function loadLocalData() {
        const data = localStorage.getItem('pendingITSIDs');
        return data ? JSON.parse(data) : [];
    }

    // Function to send data to the server
    function sendDataToServer(data) {
        fetch('/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        })
            .then(response => response.json())  // Convert the response to JSON
            .then(response => {
                if (response.results) {
                    handleServerResponse(response);  // Call your function with the response
                } else {
                    console.error('No results returned from the server');
                }
            })
            .catch(error => console.error('Error sending data:', error));
    }

    // Function to handle sending stored ITS IDs when back online
    function handleOnline() {
        const localData = loadLocalData();
        if (localData.length > 0) {
            sendDataToServer(localData);
            localStorage.removeItem('pendingITSIDs'); // Clear local storage after sending
        }
    }

    // Listen for online and offline events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', () => {
        console.log('You are offline. Any new data will be stored locally.');
    });
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

function updateNetworkStatus() {
    const statusDiv = document.getElementById('network-status');
    if (navigator.onLine) {
        statusDiv.textContent = 'Online';
        statusDiv.classList.remove('offline');
        handleOnline(); // Trigger sync operations and UI updates
        console.log('You are now online. Syncing data...');
    } else {
        statusDiv.textContent = 'Offline - Working locally';
        statusDiv.classList.add('offline');
        console.log('You are offline. Your actions will be saved and synced later.');
    }
}

function showNotification(successCount, failCount) {
    const notification = document.getElementById('notification');
    const message = document.getElementById('notificationMessage');
    message.textContent = `${successCount} ITS IDs successfully sent, ${failCount} failed.`;

    // Show the notification
    notification.style.display = 'block';

    // Hide the notification after 5 seconds
    setTimeout(() => {
        notification.style.display = 'none';
    }, 5000); // 5000 milliseconds = 5 seconds
}


// This function is assumed to be called with the response from the server
function handleServerResponse(response) {
    const successfulResults = response.results.filter(result => result.success);
    const failedResults = response.results.filter(result => !result.success);

    showNotification(successfulResults.length, failedResults.length);

    response.results.forEach(result => {
        if (result.success) {
            console.log('Updated Successfully:', result.data.itsId);
            updateList(result.data.itsId, result.data.name); // Update UI for successful updates
        } else {
            console.error('Failed to update:', result.itsId, 'Error:', result.error);
            // Optionally handle UI or notification for failures if necessary
        }
    });
}

function deleteITS(itsId) {
    // Remove from UI
    const listItem = document.querySelector(`li[data-itsid="${itsId}"]`);
    if (listItem) {
        listItem.parentNode.removeChild(listItem);
    }

    // Remove from resultList and update count
    resultList.delete(itsId);
    const totalCountElement = document.getElementById('totalCount');
    totalCountElement.textContent = resultList.size;

    // Optionally, send a message to the server or other clients to remove this ITS ID
    if (navigator.onLine) {
        fetch('/delete', { // Assuming you have a server endpoint to handle deletions
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ itsId })
        }).then(response => {
            console.log('Delete confirmed by server');
        }).catch(error => {
            console.error('Failed to delete on server:', error);
        });
    } else {
        // Optionally handle offline scenario, e.g., queue deletion to sync when back online
        console.log('Offline: Deletion will sync once online.');
    }
}

