// Global State Variables
let classesMap = {};
let sessionStats = {
    totalDetections: 0,
    inferenceTimes: [],
    classCounts: {},
    activeWebcamFps: 0
};
let detectionChart = null;
let webcamStream = null;
let webcamIntervalId = null;
let webcamActive = false;
let webcamProcessing = false;
let webcamFPSInterval = null;
let webcamFramesCount = 0;
let lastWebcamFrameTime = 0;

// Loaded original image element for crop feature
let loadedOriginalImage = null;

// Initializer
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initSliders();
    loadClasses();
    initImageStudio();
    initWebcam();
    initVideoLab();
    initCharts();
    
    // Set up status indicator
    setSystemStatus("Active", "pulsing");
});

// Helper: System Status Update
function setSystemStatus(text, className = "") {
    const textEl = document.getElementById('system-status-text');
    const dotEl = document.querySelector('.status-indicator .status-dot');
    
    textEl.textContent = text;
    dotEl.className = "status-dot";
    if (className) {
        dotEl.classList.add(className);
    }
}

// 1. Navigation / Tabs Logic
function initTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const panels = document.querySelectorAll('.tab-panel');
    const titleEl = document.getElementById('current-tab-title');
    const subtitleEl = document.getElementById('current-tab-subtitle');
    
    const panelMeta = {
        'dashboard': { title: 'Analytics Dashboard', subtitle: 'Real-time object detection telemetry & metrics' },
        'image-studio': { title: 'Image Studio', subtitle: 'Interactive image upload, side-by-side comparative analysis, and cropping' },
        'webcam-live': { title: 'Webcam Live Stream', subtitle: 'Real-time inference feed with local bounding box rendering' },
        'video-lab': { title: 'Video Processing Lab', subtitle: 'Frame-by-frame video model analysis and playback renderer' }
    };
    
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = item.getAttribute('data-tab');
            
            // Toggle active nav class
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Toggle active panel visibility
            panels.forEach(panel => panel.classList.remove('active'));
            document.getElementById(`${tabId}-tab`).classList.add('active');
            
            // Update Headers
            titleEl.textContent = panelMeta[tabId].title;
            subtitleEl.textContent = panelMeta[tabId].subtitle;
            
            // Stop webcam if leaving webcam tab
            if (tabId !== 'webcam-live' && webcamActive) {
                stopWebcamStream();
            }
            
            // Trigger chart update if going to dashboard
            if (tabId === 'dashboard') {
                updateDashboardCharts();
            }
        });
    });
}

// 2. Settings Slider Synchronization
function initSliders() {
    const confRange = document.getElementById('conf-range');
    const confVal = document.getElementById('conf-val');
    const iouRange = document.getElementById('iou-range');
    const iouVal = document.getElementById('iou-val');
    
    confRange.addEventListener('input', (e) => {
        confVal.textContent = parseFloat(e.target.value).toFixed(2);
    });
    
    iouRange.addEventListener('input', (e) => {
        iouVal.textContent = parseFloat(e.target.value).toFixed(2);
    });
}

// 3. Load YOLO Class Names
async function loadClasses() {
    const classListContainer = document.getElementById('class-list');
    try {
        const response = await fetch('/api/classes');
        const data = await response.json();
        
        if (data.success) {
            classesMap = data.classes;
            classListContainer.innerHTML = '';
            
            // Dynamically construct search list
            Object.entries(classesMap).forEach(([id, name]) => {
                const item = document.createElement('label');
                item.className = 'class-checkbox-item';
                item.innerHTML = `
                    <input type="checkbox" value="${id}" checked data-class-name="${name}">
                    <span>${name}</span>
                `;
                classListContainer.appendChild(item);
            });
            
            // Set up Class search filtering
            const searchInput = document.getElementById('class-search');
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const checkboxItems = classListContainer.querySelectorAll('.class-checkbox-item');
                
                checkboxItems.forEach(item => {
                    const name = item.querySelector('span').textContent.toLowerCase();
                    if (name.includes(query)) {
                        item.style.display = 'flex';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
            
            // Select & Clear Action Buttons
            document.getElementById('btn-select-all').addEventListener('click', () => {
                classListContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
            });
            
            document.getElementById('btn-clear-all').addEventListener('click', () => {
                classListContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            });
            
            setSystemStatus("System Ready - YOLOv11 Active", "pulsing");
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error("Error loading classes:", error);
        classListContainer.innerHTML = `<div class="loading-classes" style="color: var(--danger)"><i class="fa-solid fa-circle-exclamation"></i> Error loading classes</div>`;
        setSystemStatus("Model Loading Error", "bg-red");
    }
}

// Helper: Retrieve filter list of class IDs
function getFilterClasses() {
    const checkboxes = document.querySelectorAll('#class-list input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// Helper: Generates random colors matching client side canvas and table dots
const categoryColors = {};
function getClassColor(classId) {
    if (!categoryColors[classId]) {
        // Hash code representation for deterministic colors
        let hash = 0;
        const name = classesMap[classId] || `class-${classId}`;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = Math.abs(hash % 360);
        // HSL styled vibrant colors matching dark aesthetic
        categoryColors[classId] = `hsl(${hue}, 85%, 60%)`;
    }
    return categoryColors[classId];
}

// 4. Dashboard Visual Analytics Logic
function initCharts() {
    const ctx = document.getElementById('chart-distribution').getContext('2d');
    
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', sans-serif";
    
    detectionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Detections',
                data: [],
                backgroundColor: 'rgba(59, 130, 246, 0.65)',
                borderColor: '#3b82f6',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                y: { 
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { precision: 0 }
                }
            }
        }
    });
    
    document.getElementById('btn-clear-logs').addEventListener('click', () => {
        const container = document.getElementById('log-stream-container');
        container.innerHTML = `
            <div class="log-empty-state">
                <i class="fa-solid fa-terminal"></i>
                <p>Activity log is empty. Upload images or run webcam to trigger telemetry stream.</p>
            </div>
        `;
    });
}

function updateDashboardCharts() {
    if (!detectionChart) return;
    
    // Sort classes by count
    const sortedClasses = Object.entries(sessionStats.classCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10); // top 10
        
    detectionChart.data.labels = sortedClasses.map(item => item[0]);
    detectionChart.data.datasets[0].data = sortedClasses.map(item => item[1]);
    
    // Color bars deterministically
    detectionChart.data.datasets[0].backgroundColor = sortedClasses.map(item => {
        // Find class ID matching label
        const clsId = Object.keys(classesMap).find(key => classesMap[key] === item[0]);
        return clsId ? getClassColor(clsId) : '#3b82f6';
    });
    detectionChart.data.datasets[0].borderColor = sortedClasses.map(item => {
        const clsId = Object.keys(classesMap).find(key => classesMap[key] === item[0]);
        return clsId ? getClassColor(clsId) : '#3b82f6';
    });
    
    detectionChart.update();
    
    // Update general dashboard text
    document.getElementById('stat-total-detections').textContent = sessionStats.totalDetections;
    
    if (sessionStats.inferenceTimes.length > 0) {
        const avgInference = sessionStats.inferenceTimes.reduce((a, b) => a + b, 0) / sessionStats.inferenceTimes.length;
        document.getElementById('stat-latency').textContent = `${Math.round(avgInference)} ms`;
    }
    
    if (sortedClasses.length > 0) {
        document.getElementById('stat-top-class').textContent = `${sortedClasses[0][0]} (${sortedClasses[0][1]})`;
    }
}

function logTelemetry(type, message, latency = null) {
    const container = document.getElementById('log-stream-container');
    const emptyState = container.querySelector('.log-empty-state');
    if (emptyState) {
        container.innerHTML = '';
    }
    
    const time = new Date().toLocaleTimeString();
    const item = document.createElement('div');
    item.className = `log-item log-${type}`;
    
    let latencyText = latency ? `<span class="log-latency">${latency}ms</span>` : '';
    
    item.innerHTML = `
        <div>
            <span class="log-time">[${time}]</span>
            <span class="log-text">${message}</span>
        </div>
        ${latencyText}
    `;
    
    container.insertBefore(item, container.firstChild);
    
    // Limit log rows to 50
    if (container.children.length > 50) {
        container.removeChild(container.lastChild);
    }
}

// 5. Image Studio Logic
function initImageStudio() {
    const dropzone = document.getElementById('image-dropzone');
    const fileInput = document.getElementById('image-file-input');
    const comparison = document.getElementById('comparison-slider');
    const sliderCtrl = document.getElementById('slider-handle-ctrl');
    const afterWrapper = document.querySelector('.after-wrapper');
    const bar = document.querySelector('.slider-bar');
    const button = document.querySelector('.slider-button');
    
    // Setup Comparitive Slider Controls
    sliderCtrl.addEventListener('input', (e) => {
        const val = e.target.value;
        afterWrapper.style.clipPath = `polygon(0 0, ${val}% 0, ${val}% 100%, 0 100%)`;
        bar.style.left = `${val}%`;
        button.style.left = `${val}%`;
    });
    
    // File upload event drag & drop
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        }, false);
    });
    
    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            processImageFile(files[0]);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            processImageFile(e.target.files[0]);
        }
    });
    
    // Crop modal closers
    document.getElementById('btn-close-modal').addEventListener('click', hideModal);
    document.getElementById('crop-modal').addEventListener('click', (e) => {
        if (e.target.id === 'crop-modal') hideModal();
    });
    
    // Delete image event listener
    const btnDelete = document.getElementById('btn-delete-image');
    if (btnDelete) {
        btnDelete.addEventListener('click', resetImageStudio);
    }
}

function processImageFile(file) {
    if (!file.type.startsWith('image/')) {
        alert("Please drop a valid image file.");
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64Img = e.target.result;
        
        // Save original image globally to render crop canvases later
        loadedOriginalImage = new Image();
        loadedOriginalImage.src = base64Img;
        
        // Show original immediately on DOM comparison uploader
        document.getElementById('img-original').src = base64Img;
        
        // Update uploader state view to show processing loading spinner
        const dropzone = document.getElementById('image-dropzone');
        dropzone.innerHTML = `
            <i class="fa-solid fa-spinner fa-spin upload-icon"></i>
            <h3>Running YOLO11 Model Inference...</h3>
            <p>Analyzing image objects frame metrics</p>
        `;
        
        try {
            const startTime = performance.now();
            const response = await fetch('/api/detect-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: base64Img,
                    conf: document.getElementById('conf-range').value,
                    iou: document.getElementById('iou-range').value,
                    classes: getFilterClasses()
                })
            });
            
            const data = await response.json();
            const inferenceTime = Math.round(performance.now() - startTime);
            
            if (data.success) {
                // Show comparisons
                document.getElementById('img-processed').src = data.image;
                
                // Toggle workspace views
                dropzone.classList.add('hidden');
                document.getElementById('comparison-slider').classList.remove('hidden');
                
                // Populate detection counts and list table
                updateDetectionTable(data.detections);
                
                // Update session logs and charts
                const counts = data.summary;
                const detectionsText = Object.entries(counts).map(([name, num]) => `${num} ${name}(s)`).join(', ') || 'No objects';
                
                sessionStats.totalDetections += data.detections.length;
                sessionStats.inferenceTimes.push(inferenceTime);
                
                Object.entries(counts).forEach(([name, num]) => {
                    sessionStats.classCounts[name] = (sessionStats.classCounts[name] || 0) + num;
                });
                
                logTelemetry('success', `Detected: ${detectionsText}`, inferenceTime);
                updateDashboardCharts();
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            console.error(error);
            alert("Error running inference: " + error.message);
            resetImageStudio();
        }
    };
    reader.readAsDataURL(file);
}

function updateDetectionTable(detections) {
    const tbody = document.getElementById('img-detection-tbody');
    const badge = document.getElementById('img-detection-count');
    
    badge.textContent = `${detections.length} objects`;
    tbody.innerHTML = '';
    
    if (detections.length === 0) {
        tbody.innerHTML = `
            <tr class="table-empty">
                <td colspan="3">
                    <div class="table-empty-state">
                        <i class="fa-solid fa-face-meh"></i>
                        <p>No objects detected above current threshold.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    detections.forEach((d, idx) => {
        const tr = document.createElement('tr');
        const color = getClassColor(d.class_id);
        
        tr.innerHTML = `
            <td>
                <div class="table-class-cell">
                    <span class="table-color-dot" style="background-color: ${color}"></span>
                    <span>${d.class_name}</span>
                </div>
            </td>
            <td>
                <span class="table-conf-cell">${(d.confidence * 100).toFixed(1)}%</span>
            </td>
            <td>
                <button type="button" class="btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="cropDetections(${idx}, '${d.class_name}', ${d.confidence}, ${JSON.stringify(d.box)})">
                    <i class="fa-solid fa-crop-simple"></i> Crop
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function resetImageStudio() {
    const dropzone = document.getElementById('image-dropzone');
    dropzone.innerHTML = `
        <i class="fa-solid fa-cloud-arrow-up upload-icon"></i>
        <h3>Drag & Drop Image Here</h3>
        <p>Supports JPG, PNG, WEBP files up to 10MB</p>
        <button type="button" class="btn-primary" onclick="document.getElementById('image-file-input').click()">Browse Files</button>
        <input type="file" id="image-file-input" accept="image/*" style="display: none;">
    `;
    dropzone.classList.remove('hidden');
    document.getElementById('comparison-slider').classList.add('hidden');
    document.getElementById('img-detection-tbody').innerHTML = `
        <tr class="table-empty">
            <td colspan="3">
                <div class="table-empty-state">
                    <i class="fa-solid fa-image"></i>
                    <p>Upload an image to see detection breakdown.</p>
                </div>
            </td>
        </tr>
    `;
    document.getElementById('img-detection-count').textContent = '0 objects';
    loadedOriginalImage = null;
}

// Client Side Crop Logic using Temporary Canvas
function cropDetections(index, className, confidence, box) {
    if (!loadedOriginalImage) return;
    
    const [x1, y1, x2, y2] = box;
    const cropW = x2 - x1;
    const cropH = y2 - y1;
    
    // Create a temporary canvas matching crop dims
    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d');
    
    // Wait for the image to be fully parsed and loaded
    if (loadedOriginalImage.complete) {
        // Draw sub-rectangle on canvas
        ctx.drawImage(loadedOriginalImage, x1, y1, cropW, cropH, 0, 0, cropW, cropH);
        
        // Open modal with properties
        const modal = document.getElementById('crop-modal');
        document.getElementById('modal-crop-img').src = canvas.toDataURL('image/jpeg');
        document.getElementById('modal-crop-class').textContent = className;
        document.getElementById('modal-crop-conf').textContent = `${(confidence * 100).toFixed(1)}%`;
        document.getElementById('modal-crop-coords').textContent = `[${x1}, ${y1}, ${x2}, ${y2}]`;
        
        modal.classList.remove('hidden');
    } else {
        loadedOriginalImage.onload = () => {
            ctx.drawImage(loadedOriginalImage, x1, y1, cropW, cropH, 0, 0, cropW, cropH);
            const modal = document.getElementById('crop-modal');
            document.getElementById('modal-crop-img').src = canvas.toDataURL('image/jpeg');
            document.getElementById('modal-crop-class').textContent = className;
            document.getElementById('modal-crop-conf').textContent = `${(confidence * 100).toFixed(1)}%`;
            document.getElementById('modal-crop-coords').textContent = `[${x1}, ${y1}, ${x2}, ${y2}]`;
            modal.classList.remove('hidden');
        };
    }
}

function hideModal() {
    document.getElementById('crop-modal').classList.add('hidden');
}

// 6. Webcam Live Telemetry Stream
function switchToImageUpload() {
    if (webcamActive) {
        stopWebcamStream();
    }
    // Switch navigation active tab to image studio
    const navItem = document.querySelector('.nav-item[data-tab="image-studio"]');
    if (navItem) {
        navItem.click();
    }
    // Automatically trigger browse selector file uploader
    const fileInput = document.getElementById('image-file-input');
    if (fileInput) {
        fileInput.click();
    }
}

function initWebcam() {
    const btnStart = document.getElementById('btn-start-webcam');
    const btnStop = document.getElementById('btn-stop-webcam');
    const btnFallback = document.getElementById('btn-fallback-upload');
    const webcamSource = document.getElementById('webcam-source');
    
    btnStart.addEventListener('click', startWebcamStream);
    btnStop.addEventListener('click', stopWebcamStream);
    
    if (btnFallback) {
        btnFallback.addEventListener('click', switchToImageUpload);
    }
    
    webcamSource.addEventListener('change', () => {
        if (webcamActive) {
            stopWebcamStream();
            startWebcamStream();
        }
    });
    
    // Get list of system devices
    navigator.mediaDevices.enumerateDevices()
        .then(devices => {
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            const sourceContainer = document.getElementById('webcam-source-wrapper');
            
            if (videoDevices.length > 0) {
                webcamSource.innerHTML = '';
                videoDevices.forEach(device => {
                    const opt = document.createElement('option');
                    opt.value = device.deviceId;
                    opt.textContent = device.label || `Camera ${webcamSource.children.length + 1}`;
                    webcamSource.appendChild(opt);
                });
                sourceContainer.classList.remove('hidden');
            } else {
                // No camera hardware detected, update description text to let user know
                const overlayText = document.querySelector('#webcam-overlay-msg p');
                if (overlayText) {
                    overlayText.textContent = "No camera hardware detected on this device.";
                }
            }
        })
        .catch(err => console.error("Enumerate devices error:", err));
}

async function startWebcamStream() {
    const video = document.getElementById('webcam-video');
    const canvas = document.getElementById('webcam-canvas');
    const overlayMsg = document.getElementById('webcam-overlay-msg');
    const btnStop = document.getElementById('btn-stop-webcam');
    const btnStart = document.getElementById('btn-start-webcam');
    const deviceSelect = document.getElementById('webcam-source');
    const badge = document.getElementById('webcam-status-badge');
    
    const constraints = {
        video: {
            deviceId: deviceSelect.value ? { exact: deviceSelect.value } : undefined,
            width: { ideal: 640 },
            height: { ideal: 480 }
        }
    };
    
    try {
        overlayMsg.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><p>Initializing Camera...</p>`;
        
        webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = webcamStream;
        
        video.onloadedmetadata = () => {
            video.play();
            video.classList.remove('hidden');
            overlayMsg.classList.add('hidden');
            btnStart.classList.add('hidden');
            btnStop.classList.remove('hidden');
            
            // Adjust canvas sizing overlay to match video width/height
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            webcamActive = true;
            webcamProcessing = false;
            
            badge.className = "badge bg-green";
            badge.textContent = "Live";
            
            logTelemetry('info', "Webcam capture started successfully");
            
            // Run prediction loop
            webcamIntervalId = setInterval(captureWebcamFrame, 100); // 10 FPS
            
            // Run FPS stats
            webcamFramesCount = 0;
            lastWebcamFrameTime = performance.now();
            webcamFPSInterval = setInterval(updateWebcamFps, 1000);
        };
        
    } catch (error) {
        console.error("Camera access failed:", error);
        overlayMsg.innerHTML = `
            <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger)"></i>
            <p style="color: var(--danger)">Camera access error: ${error.message}</p>
            <div class="webcam-init-buttons" style="display: flex; gap: 12px; margin-top: 10px;">
                <button type="button" class="btn-primary" onclick="startWebcamStream()">Try Again</button>
                <button type="button" class="btn-secondary" id="btn-fallback-upload-err">
                    <i class="fa-solid fa-cloud-arrow-up"></i> Upload Image
                </button>
            </div>
        `;
        const btnErr = document.getElementById('btn-fallback-upload-err');
        if (btnErr) {
            btnErr.addEventListener('click', switchToImageUpload);
        }
    }
}

function stopWebcamStream() {
    const video = document.getElementById('webcam-video');
    const canvas = document.getElementById('webcam-canvas');
    const overlayMsg = document.getElementById('webcam-overlay-msg');
    const btnStop = document.getElementById('btn-stop-webcam');
    const btnStart = document.getElementById('btn-start-webcam');
    const badge = document.getElementById('webcam-status-badge');
    
    // Stop intervals
    clearInterval(webcamIntervalId);
    clearInterval(webcamFPSInterval);
    
    // Stop camera track
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
    
    // Reset video DOM
    video.srcObject = null;
    video.classList.add('hidden');
    
    // Clear canvas
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    overlayMsg.innerHTML = `
        <i class="fa-solid fa-camera-retro"></i>
        <p>Webcam is currently inactive</p>
        <div class="webcam-init-buttons" style="display: flex; gap: 12px; margin-top: 10px;">
            <button type="button" class="btn-primary" id="btn-start-webcam-re" onclick="startWebcamStream()">
                <i class="fa-solid fa-play"></i> Start Webcam
            </button>
            <button type="button" class="btn-secondary" id="btn-fallback-upload-stopped">
                <i class="fa-solid fa-cloud-arrow-up"></i> Upload Image
            </button>
        </div>
    `;
    
    const btnRe = document.getElementById('btn-fallback-upload-stopped');
    if (btnRe) {
        btnRe.addEventListener('click', switchToImageUpload);
    }
    
    overlayMsg.classList.remove('hidden');
    btnStop.classList.add('hidden');
    btnStart.classList.remove('hidden');
    
    webcamActive = false;
    webcamProcessing = false;
    
    badge.className = "badge bg-red";
    badge.textContent = "Offline";
    
    document.getElementById('webcam-latency-txt').textContent = '-- ms';
    document.getElementById('webcam-fps-txt').textContent = '--';
    
    document.getElementById('webcam-summary-items').innerHTML = `
        <div class="summary-empty-state">
            <i class="fa-solid fa-satellite-dish"></i>
            <p>Start webcam feed to begin processing streams.</p>
        </div>
    `;
    
    logTelemetry('info', "Webcam capture stopped");
}

function updateWebcamFps() {
    const now = performance.now();
    const elapsed = (now - lastWebcamFrameTime) / 1000;
    const fps = Math.round(webcamFramesCount / elapsed);
    
    document.getElementById('webcam-fps-txt').textContent = fps;
    document.getElementById('stat-fps').textContent = fps;
    
    sessionStats.activeWebcamFps = fps;
    
    webcamFramesCount = 0;
    lastWebcamFrameTime = now;
}

async function captureWebcamFrame() {
    if (!webcamActive || webcamProcessing) return;
    
    const video = document.getElementById('webcam-video');
    const canvas = document.getElementById('webcam-canvas');
    
    // Create temporary processing canvas to retrieve base64 JPG
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Draw current frame to temp canvas
    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
    const base64Img = tempCanvas.toDataURL('image/jpeg', 0.6); // Compress quality to 60% for speed
    
    webcamProcessing = true;
    const startTime = performance.now();
    
    try {
        const response = await fetch('/api/detect-frame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: base64Img,
                conf: document.getElementById('conf-range').value,
                classes: getFilterClasses()
            })
        });
        
        const data = await response.json();
        const latency = Math.round(performance.now() - startTime);
        
        if (data.success && webcamActive) {
            // Render bounding boxes client side
            drawWebcamBoxes(data.detections);
            
            // Update latency DOM
            document.getElementById('webcam-latency-txt').textContent = `${latency} ms`;
            
            // Update webcam class summaries panel
            updateWebcamSummary(data.summary);
            
            // Accumulate statistics
            sessionStats.totalDetections += data.detections.length;
            sessionStats.inferenceTimes.push(latency);
            
            // Limit latency array length
            if (sessionStats.inferenceTimes.length > 100) {
                sessionStats.inferenceTimes.shift();
            }
            
            // Accumulate class counts
            Object.entries(data.summary).forEach(([name, num]) => {
                sessionStats.classCounts[name] = (sessionStats.classCounts[name] || 0) + num;
            });
            
            webcamFramesCount++;
        }
    } catch (err) {
        console.error("Frame analysis error:", err);
    } finally {
        webcamProcessing = false;
    }
}

function drawWebcamBoxes(detections) {
    const canvas = document.getElementById('webcam-canvas');
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    detections.forEach(d => {
        const [x1, y1, x2, y2] = d.box;
        const color = getClassColor(d.class_id);
        
        // Draw Bounding box
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        
        // Draw Label tag
        const label = `${d.class_name} ${(d.confidence * 100).toFixed(0)}%`;
        ctx.font = 'bold 12px "Inter", sans-serif';
        const labelWidth = ctx.measureText(label).width;
        const labelHeight = 18;
        
        ctx.fillStyle = color;
        // Background for text
        ctx.fillRect(x1 - 1, y1 - labelHeight, labelWidth + 10, labelHeight);
        
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x1 + 4, y1 - 5);
    });
}

function updateWebcamSummary(summary) {
    const container = document.getElementById('webcam-summary-items');
    
    const items = Object.entries(summary);
    if (items.length === 0) {
        container.innerHTML = `
            <div class="summary-empty-state">
                <i class="fa-solid fa-ghost"></i>
                <p>No objects visible in camera field.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    items.forEach(([name, count]) => {
        // Find matching class ID for color
        const clsId = Object.keys(classesMap).find(key => classesMap[key] === name);
        const color = clsId ? getClassColor(clsId) : '#3b82f6';
        
        const card = document.createElement('div');
        card.className = 'summary-item-card';
        card.innerHTML = `
            <div class="summary-item-left">
                <span class="summary-item-dot" style="background-color: ${color}"></span>
                <span class="summary-item-name">${name}</span>
            </div>
            <span class="summary-item-count">${count}</span>
        `;
        container.appendChild(card);
    });
}

// 7. Video Lab Logic
function initVideoLab() {
    const dropzone = document.getElementById('video-dropzone');
    const fileInput = document.getElementById('video-file-input');
    const btnReset = document.getElementById('btn-reset-video');
    const btnDownload = document.getElementById('btn-download-video');
    
    let activeTaskId = null;
    let statusPollerId = null;
    
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        }, false);
    });
    
    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            uploadVideoFile(files[0]);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            uploadVideoFile(e.target.files[0]);
        }
    });
    
    btnReset.addEventListener('click', resetVideoLab);
    
    async function uploadVideoFile(file) {
        if (!file.type.startsWith('video/')) {
            alert("Please choose a valid video file.");
            return;
        }
        
        // Show loading screen state
        dropzone.classList.add('hidden');
        document.getElementById('video-processing-view').classList.remove('hidden');
        updateProgress(0, "Uploading source file...", "Sending video data to server...");
        
        const formData = new FormData();
        formData.append('video', file);
        formData.append('conf', document.getElementById('conf-range').value);
        formData.append('iou', document.getElementById('iou-range').value);
        
        // Append all filters
        getFilterClasses().forEach(c => formData.append('classes', c));
        
        try {
            const response = await fetch('/api/detect-video', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            
            if (data.success) {
                activeTaskId = data.task_id;
                // Start status polling
                statusPollerId = setInterval(pollVideoStatus, 1500);
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            console.error("Video upload error:", error);
            alert("Video upload failed: " + error.message);
            resetVideoLab();
        }
    }
    
    async function pollVideoStatus() {
        if (!activeTaskId) return;
        
        try {
            const response = await fetch(`/api/video-status/${activeTaskId}`);
            const data = await response.json();
            
            if (data.success) {
                const task = data.task;
                if (task.status === 'processing') {
                    updateProgress(
                        task.progress, 
                        `Processing YOLO Model Inference...`, 
                        `Frame ${task.current_frame} of ${task.total_frames} (${task.progress}%)`
                    );
                } else if (task.status === 'completed') {
                    clearInterval(statusPollerId);
                    showVideoOutput(task.url);
                    logTelemetry('success', `Processed video successfully: task ${activeTaskId}`);
                } else if (task.status === 'error') {
                    clearInterval(statusPollerId);
                    alert("Error processing video: " + task.error);
                    resetVideoLab();
                }
            }
        } catch (err) {
            console.error("Error checking status:", err);
        }
    }
    
    function updateProgress(percent, title, detail) {
        document.getElementById('video-progress-title').textContent = title;
        document.getElementById('video-progress-fill').style.width = `${percent}%`;
        document.getElementById('video-progress-detail').textContent = detail;
    }
    
    function showVideoOutput(url) {
        document.getElementById('video-processing-view').classList.add('hidden');
        document.getElementById('video-playback-view').classList.remove('hidden');
        
        const video = document.getElementById('video-player-output');
        video.src = url;
        video.load();
        
        btnDownload.onclick = () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = `yolo11_detected_${activeTaskId}.mp4`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };
    }
    
    function resetVideoLab() {
        clearInterval(statusPollerId);
        activeTaskId = null;
        
        const video = document.getElementById('video-player-output');
        video.src = '';
        
        document.getElementById('video-playback-view').classList.add('hidden');
        document.getElementById('video-processing-view').classList.add('hidden');
        
        fileInput.value = '';
        dropzone.classList.remove('hidden');
    }
}
