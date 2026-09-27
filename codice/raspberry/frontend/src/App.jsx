import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Thermometer,
    Droplets,
    Lightbulb,
    Activity,
    Video,
    Wind,
    Menu,
    Settings,
    AlertTriangle,
    Fish,
    Waves,
    Sun,
    Maximize2,
    Sparkles,
    MessageSquare,
    X,
    Send,
    Loader,
    RefreshCw,
    Zap,
    Calendar,
    Clock,
    Plus,
    Trash2,
    Check,
    WifiOff,
    Wifi,
    Edit2,
    Edit3,
    Bell,
    ToggleRight,
    Search,
    Download,
    Upload,
    UploadCloud,
    Leaf,
    List,
    History,
    ChevronLeft,
    LogOut,
    Info,
    BookOpen,
    Grid,
    ArrowRight,
    RotateCcw
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

// ============== API CONFIGURATION ==============
const API_BASE = '/api';
const WS_URL = `ws://${window.location.host}/ws`;

// ============== AGENT TOOLS DEFINITION ==============
const AQUARIUM_TOOLS = {
    function_declarations: [
        {
            name: "set_device_state",
            description: "Accende o spegne un dispositivo specifico dell'acquario (luci, pompe, skimmer).",
            parameters: {
                type: "OBJECT",
                properties: {
                    device_id: {
                        type: "STRING",
                        enum: ["mainLight", "blueLight", "pump", "skimmer", "feeder"],
                        description: "L'ID del dispositivo da controllare."
                    },
                    state: {
                        type: "BOOLEAN",
                        description: "True per accendere (ON), False per spegnere (OFF)."
                    }
                },
                required: ["device_id", "state"]
            }
        },
        {
            name: "save_recipe",
            description: "Salva una ricetta o guida pratica nel database. Usalo quando generi procedure di cura o manutenzione utili per il futuro.",
            parameters: {
                type: "OBJECT",
                properties: {
                    title: {
                        type: "STRING",
                        description: "Titolo della ricetta (es. 'Cura Ictio')."
                    },
                    content: {
                        type: "STRING",
                        description: "Contenuto della guida in Markdown."
                    },
                    category: {
                        type: "STRING",
                        description: "Categoria (es. 'malattie', 'nutrizione')."
                    }
                },
                required: ["title", "content"]
            }
        }
    ]
};

// Simple Markdown Renderer Component
const SimpleMarkdownRenderer = ({ content }) => {
    if (!content) return null;

    // Split content by newlines to handle blocks
    const lines = content.split('\n');
    let inList = false;

    return (
        <div className="space-y-2 text-sm text-slate-300 leading-relaxed">
            {lines.map((line, idx) => {
                // Headers
                if (line.startsWith('### ')) {
                    return <h3 key={idx} className="text-lg font-bold text-cyan-400 mt-4 mb-2">{line.replace('### ', '')}</h3>;
                }
                if (line.startsWith('## ')) {
                    return <h2 key={idx} className="text-xl font-bold text-slate-100 mt-6 mb-3 border-b border-slate-700 pb-1">{line.replace('## ', '')}</h2>;
                }
                if (line.startsWith('**') && line.endsWith('**')) {
                    return <p key={idx} className="font-bold text-slate-200">{line.replace(/\*\*/g, '')}</p>
                }

                // List items
                if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
                    const cleanLine = line.trim().replace(/^[-*]\s/, '');
                    // Handle bold inside list items
                    const parts = cleanLine.split(/(\*\*.*?\*\*)/g);
                    return (
                        <div key={idx} className="flex gap-2 ml-2">
                            <span className="text-cyan-500 mt-1.5">•</span>
                            <p className="flex-1">
                                {parts.map((part, i) => {
                                    if (part.startsWith('**') && part.endsWith('**')) {
                                        return <strong key={i} className="text-cyan-100 font-semibold">{part.replace(/\*\*/g, '')}</strong>;
                                    }
                                    return part;
                                })}
                            </p>
                        </div>
                    );
                }

                // Numbered lists
                if (/^\d+\.\s/.test(line.trim())) {
                    const cleanLine = line.trim().replace(/^\d+\.\s/, '');
                    const parts = cleanLine.split(/(\*\*.*?\*\*)/g);
                    return (
                        <div key={idx} className="flex gap-2 ml-2">
                            <span className="text-cyan-500 font-mono mt-0.5">{line.trim().match(/^\d+\./)[0]}</span>
                            <p className="flex-1">
                                {parts.map((part, i) => {
                                    if (part.startsWith('**') && part.endsWith('**')) {
                                        return <strong key={i} className="text-cyan-100 font-semibold">{part.replace(/\*\*/g, '')}</strong>;
                                    }
                                    return part;
                                })}
                            </p>
                        </div>
                    );
                }

                // Paragraphs with bold text
                if (line.trim() === '') return <br key={idx} />;

                const parts = line.split(/(\*\*.*?\*\*)/g);
                return (
                    <p key={idx}>
                        {parts.map((part, i) => {
                            if (part.startsWith('**') && part.endsWith('**')) {
                                return <strong key={i} className="text-cyan-100 font-semibold">{part.replace(/\*\*/g, '')}</strong>;
                            }
                            return part;
                        })}
                    </p>
                );
            })}
        </div>
    );
};

// Helper to calculate Redfield Ratio (Buddy Ratio approximation)
// Ratio = (NO3 / PO4) * 1.53
// < 10: Ciano Risk, 10-22: Balanced, > 22: GSA Risk
const calculateRedfield = (no3, po4) => {
    if (!no3 || !po4 || parseFloat(po4) === 0) return null;
    const n = parseFloat(no3);
    const p = parseFloat(po4);
    const ratio = (n / p) * 1.53;

    let status = 'balanced'; // green
    let label = 'Bilanciato';
    let color = 'text-green-400';
    let bgColor = 'bg-green-400/10';
    let borderColor = 'border-green-400/20';

    if (ratio < 10) {
        status = 'cyano';
        label = 'Rischio Ciano'; // Blue-Green Algae
        color = 'text-red-400';
        bgColor = 'bg-red-400/10';
        borderColor = 'border-red-400/20';
    } else if (ratio > 22) {
        status = 'gsa';
        label = 'Rischio GSA'; // Green Spot Algae
        color = 'text-orange-400';
        bgColor = 'bg-orange-400/10';
        borderColor = 'border-orange-400/20';
    }

    return { value: ratio.toFixed(1), status, label, color, bgColor, borderColor };
};

// Helper to calculate CO2 from pH and KH
// CO2 (ppm) = 3 * KH * 10^(7-pH)
const calculateCO2 = (ph, kh) => {
    if (!ph || !kh) return null;
    const p = parseFloat(ph);
    const k = parseFloat(kh);
    const co2 = 3 * k * Math.pow(10, 7 - p);
    return co2.toFixed(1);
};

const App = () => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [newTankDims, setNewTankDims] = useState({ width: '', height: '', depth: '', volume: '' });
    // newTankImgSettings removed from state, handled directly via tank update or local temp state
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [isConnected, setIsConnected] = useState(false);
    const [fishGridColumns, setFishGridColumns] = useState(3);
    const [plantsGridColumns, setPlantsGridColumns] = useState(3);

    // AI State
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [aiMode, setAiMode] = useState('analysis');
    const [isMobileHistoryOpen, setIsMobileHistoryOpen] = useState(false);
    const [aiResponse, setAiResponse] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [userQuery, setUserQuery] = useState('');
    const [lastAction, setLastAction] = useState(null);
    const responseEndRef = useRef(null);

    // AI Chat History State
    const [conversations, setConversations] = useState([]);
    const [currentConversationId, setCurrentConversationId] = useState(null);

    const [recipes, setRecipes] = useState([]);
    const [viewingRecipe, setViewingRecipe] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);

    // Sensor State
    const [sensors, setSensors] = useState({
        temp: null,
        ph: null,
        tds: null,
        level: null
    });

    const [historyData, setHistoryData] = useState([]);
    const [historyStats, setHistoryStats] = useState(null);
    const [historyRange, setHistoryRange] = useState(6); // Default 6 hours
    const [visibleParams, setVisibleParams] = useState(['temp', 'ph', 'tds', 'level']); // All visible by default
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [historyLog, setHistoryLog] = useState([]);


    // Drag and Drop (Fish Modal)
    const [isDragging, setIsDragging] = useState(false);
    const [dragDropPreview, setDragDropPreview] = useState(null);

    // Time range options for history chart
    const historyRangeOptions = [
        { label: '1h', hours: 1 },
        { label: '3h', hours: 3 },
        { label: '6h', hours: 6 },
        { label: '12h', hours: 12 },
        { label: '24h', hours: 24 },
        { label: '3gg', hours: 72 },
        { label: '7gg', hours: 168 },
        { label: '14gg', hours: 336 },
        { label: '1m', hours: 720 },
        { label: '3m', hours: 2160 },
        { label: '6m', hours: 4320 },
        { label: '9m', hours: 6480 },
        { label: '1a', hours: 8760 },
    ];

    // Dynamic chart height based on time range
    const getChartHeight = () => {
        if (historyRange <= 24) return 'h-32';      // 1h-24h: compact
        if (historyRange <= 168) return 'h-40';     // 3gg-7gg: medium
        if (historyRange <= 720) return 'h-48';     // 14gg-1m: larger
        if (historyRange <= 2160) return 'h-56';    // 3m: larger
        return 'h-64';                               // 6m-1a: maximum
    };

    // Actuator State
    const [controls, setControls] = useState({
        mainLight: false,
        blueLight: false,
        skimmer: true,
        pump: true,
        heater: true,
        feeder: false
    });

    // Scheduling State
    const [schedules, setSchedules] = useState([]);
    const [isAddScheduleOpen, setIsAddScheduleOpen] = useState(false);
    const [isLevelCalibrationOpen, setIsLevelCalibrationOpen] = useState(false);
    const [isPhCalibrationOpen, setIsPhCalibrationOpen] = useState(false);
    const [isTdsCalibrationOpen, setIsTdsCalibrationOpen] = useState(false);
    const [isTempCalibrationOpen, setIsTempCalibrationOpen] = useState(false);

    const [levelConfig, setLevelConfig] = useState({ minDistance: 5.0, maxDistance: 15.0 });
    const [phConfig, setPhConfig] = useState({ offset: 0.0 });
    const [tdsConfig, setTdsConfig] = useState({ kValue: 1.0 });
    const [tempConfig, setTempConfig] = useState({ offset: 0.0 });
    const [editingScheduleId, setEditingScheduleId] = useState(null); // null = create mode, id = edit mode
    const [newSchedule, setNewSchedule] = useState({
        deviceId: 'mainLight',
        label: '',
        days: [],
        startTime: '09:00',
        endTime: '17:00',
        quantity: 1 // For feeder: 1, 2, or 3
    });

    // Devices with active schedules (manual control disabled)
    const [scheduledDevices, setScheduledDevices] = useState([]);

    // Tank State
    const [tanks, setTanks] = useState([]);
    const [selectedTankId, setSelectedTankId] = useState(1);
    // Discovery State
    const [discoveredDevices, setDiscoveredDevices] = useState([]);
    const [isScanningDevices, setIsScanningDevices] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isAddTankModalOpen, setIsAddTankModalOpen] = useState(false);
    const [isManageTanksModalOpen, setIsManageTanksModalOpen] = useState(false);
    const [editingTank, setEditingTank] = useState(null); // Track tank being edited
    const [newTankType, setNewTankType] = useState('esp32_wifi'); // For dynamic add modal

    // Fullscreen State
    const [isFullscreen, setIsFullscreen] = useState(false);
    const videoContainerRef = useRef(null);
    const streamImgRef = useRef(null);

    // Camera Settings State
    const [isCameraSettingsOpen, setIsCameraSettingsOpen] = useState(false);
    const [cameraSettings, setCameraSettings] = useState({
        resolution: '1280x720',
        fps: 15,
        available: { resolutions: [], fps: [] }
    });
    const [cameraTimestamp, setCameraTimestamp] = useState(Date.now());
    const [cameraRebooting, setCameraRebooting] = useState(false);
    const [isVideoLoading, setIsVideoLoading] = useState(true);

    // Alert System State
    const [alertThresholds, setAlertThresholds] = useState([]);
    const [notificationSettings, setNotificationSettings] = useState({
        provider: 'ntfy',
        ntfy_server: 'https://ntfy.sh',
        ntfy_topic: '',
        telegram_bot_token: '',
        telegram_chat_id: '',
        notify_device_triggers: true,
        notify_thresholds: true,
        notify_delta: true,
        enabled: false
    });
    const [alertLog, setAlertLog] = useState([]);

    // Chihiros LED State
    const [chihirosDevices, setChihirosDevices] = useState([]);
    const [chihirosScanResults, setChihirosScanResults] = useState([]);
    const [isScanning, setIsScanning] = useState(false);
    const [showAddLampModal, setShowAddLampModal] = useState(false);
    const [pendingBrightness, setPendingBrightness] = useState({});
    const [pendingRGB, setPendingRGB] = useState({});
    const brightnessDebounceRef = useRef({});

    // Maintenance, Water Parameters, Fish State
    const [maintenanceLog, setMaintenanceLog] = useState([]);
    const [maintenanceRules, setMaintenanceRules] = useState([]); // Recurring rules
    const [waterParams, setWaterParams] = useState([]);
    const [fishInventory, setFishInventory] = useState([]);
    const [plantsInventory, setPlantsInventory] = useState([]);
    const [calendarMonth, setCalendarMonth] = useState(new Date());
    const [showAddMaintenanceModal, setShowAddMaintenanceModal] = useState(false);
    const [isMaintenanceRecurring, setIsMaintenanceRecurring] = useState(false);
    const [maintenanceFrequency, setMaintenanceFrequency] = useState('interval'); // interval, weekly, monthly
    const [showAddFishModal, setShowAddFishModal] = useState(false);
    const [editingFish, setEditingFish] = useState(null);
    const [showAddPlantModal, setShowAddPlantModal] = useState(false);
    const [editingPlant, setEditingPlant] = useState(null);
    const [showAddWaterParamsModal, setShowAddWaterParamsModal] = useState(false);
    const [editingWaterParams, setEditingWaterParams] = useState(null);
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);

    // Backup & Restore State
    const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
    const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
    const [restoreFileContent, setRestoreFileContent] = useState(null);
    const [backupSelection, setBackupSelection] = useState({
        config: true,
        schedules: true,
        livestock: true,
        history: true
    });
    const [restoreSelection, setRestoreSelection] = useState({
        config: true,
        schedules: true,
        livestock: true,
        history: true
    });

    // Parameter definitions for thresholds
    const parameterDefs = [
        { id: 'temp', name: 'Temperatura', unit: '°C', defaultMin: 24, defaultMax: 27 },
        { id: 'ph', name: 'pH', unit: '', defaultMin: 8.0, defaultMax: 8.4 },
        { id: 'tds', name: 'TDS', unit: 'ppm', defaultMin: 100, defaultMax: 500 },
        { id: 'level', name: 'Livello', unit: '%', defaultMin: 20, defaultMax: 100 }
    ];

    // WebSocket reference
    const wsRef = useRef(null);
    const selectedTankIdRef = useRef(selectedTankId);

    // Keep ref in sync with state
    useEffect(() => {
        selectedTankIdRef.current = selectedTankId;
    }, [selectedTankId]);

    // ==============    // --- CALIBRATION MODE TRIGGER ---
    useEffect(() => {
        if (!selectedTankId) return;
        const isCalibrating = isPhCalibrationOpen || isTdsCalibrationOpen;

        const toggleCalibrationMode = async () => {
            try {
                await fetch(`${API_BASE}/tanks/${selectedTankId}/calibration-mode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ active: isCalibrating })
                });
                console.log(`Calibration Mode set to ${isCalibrating}`);
            } catch (err) {
                console.error("Failed to toggle calibration mode", err);
            }
        };

        toggleCalibrationMode();

        // Cleanup: If component unmounts while calibrating, try to turn off
        return () => {
            if (isCalibrating) {
                fetch(`${API_BASE}/tanks/${selectedTankId}/calibration-mode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ active: false })
                }).catch(() => { });
            }
        };
    }, [isPhCalibrationOpen, isTdsCalibrationOpen, selectedTankId]);

    // ============== CAMERA STREAM LAZY LOADING ==============
    // Stop camera stream when not viewing dashboard, restart when returning
    useEffect(() => {
        const streamImg = document.querySelector('img[alt="Aquarium Live Feed"]');
        if (!streamImg) return;

        if (activeTab === 'dashboard') {
            // Use stable URL with tankId but without timestamp to reuse connection
            const streamUrl = `${API_BASE}/stream?tankId=${selectedTankId || 1}`;
            if (!streamImg.src.includes(`tankId=${selectedTankId || 1}`)) {
                streamImg.src = streamUrl;
                console.log(`[Camera] Stream started for Tank ${selectedTankId || 1}`);
            }
        } else {
            // Stop stream by clearing src
            streamImg.src = '';
            console.log('[Camera] Stream stopped (dashboard hidden)');
        }
    }, [activeTab, selectedTankId]);

    // --- WEBSOCKET CONNECTION ---
    useEffect(() => {
        let reconnectTimeout;

        const connect = () => {
            const ws = new WebSocket(WS_URL);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('WebSocket connected');
                setIsConnected(true);
            };

            ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);

                    if (message.type === 'init') {
                        // Only apply init sensors if we are on the default tank (1), usually on first load.
                        // If user has navigated to Tank 2, we shouldn't overwrite with Tank 1 data from init.
                        if (selectedTankIdRef.current === 1) {
                            setSensors(message.sensors);
                            setControls(message.controls);
                        }
                    } else if (message.type === 'sensors_update') {
                        // Filter updates by selected tank
                        if (message.tankId === selectedTankIdRef.current) {
                            setSensors(message.data);
                        }
                    } else if (message.type === 'controls') {
                        // Filter controls update by selected tank
                        if (message.tankId === selectedTankIdRef.current) {
                            setControls(message.data);
                        }
                    } else if (message.type === 'new_alert') {
                        // Add new alert to log in real-time
                        // Filter by tank? User probably wants to see all alerts or just current tank?
                        // Let's show all alerts in log, but maybe highlight current tank?
                        setAlertLog(prev => [message.data, ...prev.slice(0, 49)]);
                    }
                } catch (e) {
                    console.error('WebSocket message error:', e);
                }
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected');
                setIsConnected(false);
                // Reconnect after 3 seconds
                reconnectTimeout = setTimeout(connect, 3000);
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                ws.close();
            };
        };

        connect();

        return () => {
            clearTimeout(reconnectTimeout);
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    // ============== INITIAL DATA FETCH ==============
    // ============== INITIAL DATA FETCH ==============
    useEffect(() => {
        // Fetch Tanks List
        fetch(`${API_BASE}/tanks`)
            .then(res => res.json())
            .then(data => {
                setTanks(data);
                // Ensure valid selection
                if (data.length > 0 && !data.find(t => t.id === selectedTankId)) {
                    setSelectedTankId(data[0].id);
                }
            })
            .catch(console.error);
    }, []);

    useEffect(() => {
        setIsVideoLoading(true);
    }, [selectedTankId]);

    useEffect(() => {
        if (!selectedTankId) return;

        // Fetch initial data for selected tank
        // Global sensors/controls (currently shared, but could be filtered later)
        fetch(`${API_BASE}/sensors?tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setSensors(data))
            .catch(console.error);

        // Fetch controls - filtered by Tank ID ideally, but keeping global for now as controls table has tank_id but API returns all?
        // Actually API was not updated to filter controls by tankId yet, let's assume global control for now or update later.
        // Wait, controls table HAS tank_id. But /api/controls endpoint wasn't updated in Step 2.
        // User checklist didn't explicitly say controls needed filtering yet, but `schedules` did.
        fetch(`${API_BASE}/controls?tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setControls(data)) // Note: API might ignore tankId query if not implemented, which is fine for now
            .catch(console.error);

        fetch(`${API_BASE}/schedules?tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setSchedules(data))
            .catch(console.error);

        fetch(`${API_BASE}/sensors/history?hours=24&tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => {
                if (data.history) {
                    setHistoryData(data.history);
                    setHistoryStats(data.stats);
                } else {
                    setHistoryData(data);
                }
            })
            .catch(console.error);

        // Fetch camera settings (Global for now)
        fetch(`${API_BASE}/camera/settings`)
            .then(res => res.json())
            .then(data => setCameraSettings(data))
            .catch(console.error);

        // Fetch devices with active schedules
        fetch(`${API_BASE}/schedules/active-devices?tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setScheduledDevices(data))
            .catch(console.error);

        // Fetch alert thresholds
        fetch(`${API_BASE}/alerts/thresholds?tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setAlertThresholds(data))
            .catch(console.error);

        // Fetch notification settings (Global)
        fetch(`${API_BASE}/alerts/settings`)
            .then(res => res.json())
            .then(data => setNotificationSettings(prev => ({ ...prev, ...data })))
            .catch(console.error);

        // Fetch alert log
        fetch(`${API_BASE}/alerts/log?limit=50&tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setAlertLog(data))
            .catch(console.error);

        // Fetch Chihiros devices
        fetch(`${API_BASE}/chihiros/devices?tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setChihirosDevices(data))
            .catch(console.error);

        // Fetch maintenance log
        fetch(`${API_BASE}/maintenance?tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setMaintenanceLog(data))
            .catch(console.error);

        // Fetch recurring maintenance rules
        fetch(`${API_BASE}/maintenance/recurring?tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setMaintenanceRules(data))
            .catch(console.error);

        // Fetch fish inventory
        fetch(`${API_BASE}/livestock?tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setFishInventory(data))
            .catch(console.error);

        // Fetch water parameters
        fetch(`${API_BASE}/water-params?tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setWaterParams(data))
            .catch(console.error);

        // Fetch fish inventory
        fetch(`${API_BASE}/fish?tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setFishInventory(data))
            .catch(console.error);

        // Fetch plants inventory
        fetch(`${API_BASE}/plants?tankId=${selectedTankId}`)
            .then(res => res.json())
            .then(data => setPlantsInventory(data))
            .catch(console.error);
    }, [selectedTankId]);

    // ============== TIME UPDATE ==============
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // ============== HISTORY REFRESH ==============
    // Fetch history when range changes
    useEffect(() => {
        const fetchHistory = () => {
            fetch(`${API_BASE}/sensors/history?hours=${historyRange}&tankId=${selectedTankId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.history) {
                        setHistoryData(data.history);
                        setHistoryStats(data.stats);
                    } else {
                        setHistoryData(data);
                    }
                })
                .catch(console.error);
        };
        fetchHistory();

        const historyTimer = setInterval(fetchHistory, 60000); // Refresh every minute
        return () => clearInterval(historyTimer);
    }, [historyRange, selectedTankId]);



    // ============== CONTROL TOGGLE ==============
    // Check if device has active schedule (manual control disabled)
    const isDeviceScheduled = (deviceId) => scheduledDevices.includes(deviceId);

    const toggleControl = useCallback(async (key) => {
        // Prevent manual control if device has active schedule
        if (isDeviceScheduled(key)) {
            console.log(`${key} has active schedule, manual control disabled`);
            return;
        }

        const newState = !controls[key];

        try {
            const res = await fetch(`${API_BASE}/controls`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device: key, state: newState, tankId: selectedTankId })
            });
            const data = await res.json();
            if (data.controls) {
                setControls(data.controls);
            }
        } catch (error) {
            console.error('Control toggle error:', error);
        }
    }, [controls, scheduledDevices, selectedTankId]);

    // Helper function to determine sensor value color based on alert thresholds
    const getStatusColor = (value, parameter) => {
        if (value === null || value === undefined) return 'text-slate-500';

        // Find threshold for this parameter
        const threshold = alertThresholds.find(t => t.parameter === parameter && t.enabled);
        if (!threshold) return 'text-slate-200'; // No threshold configured, default color

        // Check if value is within range
        const isAboveMin = threshold.min_value === null || value >= threshold.min_value;
        const isBelowMax = threshold.max_value === null || value <= threshold.max_value;

        if (isAboveMin && isBelowMax) {
            return 'text-emerald-400'; // Green - within range
        } else {
            return 'text-rose-400'; // Red - outside range
        }
    };

    // ============== MAINTENANCE REMINDER LOGIC ==============
    const upcomingEvents = React.useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const labels = {
            water_change: 'Cambio Acqua',
            filter_clean: 'Pulizia Filtro',
            fertilizer: 'Fertilizzante',
            medication: 'Medicinale',
            note: 'Nota'
        };

        // Helper: Parse "YYYY-MM-DD" to Local Midnight Date
        const parseLocal = (str) => {
            if (!str) return null;
            const [y, m, d] = str.split('-').map(Number);
            return new Date(y, m - 1, d);
        };

        // Helper: Format Local Date to "YYYY-MM-DD"
        const formatLocal = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };

        // 1. One-off events
        const oneOffs = maintenanceLog
            .map(e => ({ ...e, dateObj: parseLocal(e.date), isRecurring: false }))
            .filter(e => e.dateObj && e.dateObj >= today);

        // 2. Recurring events
        const recurringEvents = (maintenanceRules || []).map(rule => {
            let nextDate = parseLocal(rule.start_date) || new Date();
            nextDate.setHours(0, 0, 0, 0);

            // If start date is in past, calculate next occurrence
            if (nextDate < today) {
                if (rule.frequency === 'daily' || rule.frequency === 'interval') {
                    const diffTime = today - nextDate;
                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                    const interval = rule.interval || 1;
                    const intervalsToAdd = Math.ceil(diffDays / interval);
                    nextDate.setDate(nextDate.getDate() + (intervalsToAdd * interval));

                    if (nextDate < today) {
                        nextDate.setDate(nextDate.getDate() + interval);
                    }
                } else if (rule.frequency === 'weekly') {
                    let temp = new Date(today);
                    temp.setHours(0, 0, 0, 0);

                    let found = false;
                    for (let i = 0; i < 14; i++) {
                        if (rule.weekdays && rule.weekdays.includes(temp.getDay())) {
                            nextDate = new Date(temp);
                            found = true;
                            break;
                        }
                        temp.setDate(temp.getDate() + 1);
                    }
                    if (!found) nextDate = null;
                } else if (rule.frequency === 'monthly') {
                    let dom = rule.day_of_month || parseLocal(rule.start_date).getDate();
                    let temp = new Date(today.getFullYear(), today.getMonth(), dom);
                    if (temp < today) {
                        temp.setMonth(temp.getMonth() + 1);
                    }
                    nextDate = temp;
                }
            }

            return {
                ...rule,
                date: nextDate ? formatLocal(nextDate) : null,
                dateObj: nextDate,
                isRecurring: true
            };
        }).filter(e => e.dateObj && e.dateObj >= today);

        return [...oneOffs, ...recurringEvents]
            .sort((a, b) => a.dateObj - b.dateObj)
            .slice(0, 4)
            .map(event => {
                const diffTime = event.dateObj - today;
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

                const d = event.dateObj;
                const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

                return {
                    ...event,
                    label: labels[event.type] || event.type,
                    days: diffDays,
                    formattedDate: dateStr
                };
            });
    }, [maintenanceLog, maintenanceRules]);

    // ============== GEMINI AI FUNCTIONS ==============
    const performAgentAction = async (functionCall) => {
        const { name, args } = functionCall;

        if (name === 'set_device_state') {
            const { device_id, state } = args || {};

            if (!device_id) return "Errore: ID dispositivo non specificato.";

            try {
                await fetch(`${API_BASE}/controls`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ device: device_id, state })
                });

                const names = {
                    mainLight: "Luci Diurne",
                    blueLight: "Luci Lunari",
                    pump: "Pompa Risalita",
                    skimmer: "Skimmer",
                    feeder: "Mangiatoia"
                };
                return `Ho impostato ${names[device_id] || device_id} su ${state ? 'ON' : 'OFF'}.`;
            } catch (error) {
                return `Errore nel controllo del dispositivo: ${error.message}`;
            }
        }
        if (name === 'save_recipe') {
            const { title, content, category } = args || {};
            if (!title || !content) return "Errore: Titolo e contenuto richiesti per la ricetta.";

            try {
                const res = await fetch(`${API_BASE}/recipes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, content, category })
                });

                if (!res.ok) {
                    throw new Error(`Errore HTTP ${res.status} - Forse il server non è aggiornato`);
                }

                return `Ricetta "${title}" salvata correttamente. Puoi vederla nella scheda "Ricette".`;
            } catch (error) {
                console.error(error);
                return `Errore durante il salvataggio della ricetta: ${error.message}. Controlla che il backend sia riavviato.`;
            }
        }

        return `Azione sconosciuta: ${name}`;
    };

    // Capture current camera frame as base64
    const captureCameraFrame = () => {
        if (!streamImgRef.current) return null;

        try {
            const img = streamImgRef.current;
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || 640;
            canvas.height = img.naturalHeight || 480;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            // Convert to base64 (JPEG format for efficiency)
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            // Extract base64 data (remove "data:image/jpeg;base64," prefix)
            const base64Data = dataUrl.split(',')[1];
            return base64Data;
        } catch (error) {
            console.error('Failed to capture camera frame:', error);
            return null;
        }
    };

    // AI History Helpers
    const loadConversations = useCallback(async () => {
        if (!selectedTankId) return;
        try {
            const res = await fetch(`${API_BASE}/conversations?tankId=${selectedTankId}`);
            if (!res.ok) {
                console.error(`Failed to load conversations: ${res.status}`);
                return;
            }
            const data = await res.json();
            if (Array.isArray(data)) {
                setConversations(data);
            } else {
                console.error('Invalid conversations data:', data);
                setConversations([]);
            }
        } catch (error) {
            console.error('Failed to load conversations:', error);
            setConversations([]);
        }
    }, [selectedTankId]);

    const loadRecipes = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/recipes`);
            if (!res.ok) throw new Error("API Error");
            const data = await res.json();
            setRecipes(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load recipes:', error);
            setRecipes([]);
        }
    }, []);

    const handleDeleteRecipe = async (id) => {
        if (!confirm('Eliminare questa ricetta?')) return;
        try {
            await fetch(`${API_BASE}/recipes/${id}`, { method: 'DELETE' });
            setRecipes(prev => prev.filter(r => r.id !== id));
            if (viewingRecipe?.id === id) setViewingRecipe(null);
        } catch (e) {
            console.error(e);
            alert('Errore eliminazione');
        }
    };

    useEffect(() => {
        if (isAiModalOpen && selectedTankId) {
            loadConversations();
        }
        if (activeTab === 'ricette') {
            loadRecipes();
        }
    }, [isAiModalOpen, selectedTankId, loadConversations, activeTab, loadRecipes]);

    const loadMessages = async (conversationId) => {
        try {
            const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            if (Array.isArray(data)) {
                setChatMessages(data);
            } else {
                console.error('Invalid messages format:', data);
                setChatMessages([]);
            }
        } catch (error) {
            console.error('Failed to load messages:', error);
            setChatMessages([]);
        }
    };

    const createConversation = async (title) => {
        try {
            const payload = {
                tankId: Number(selectedTankId),
                title: (title && String(title).trim()) ? String(title).trim() : 'Nuova Conversazione'
            };

            const res = await fetch(`${API_BASE}/conversations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const newConv = await res.json();

            // EMERGENCY FIX: If backend is outdated and didn't save title, force update it via PUT
            const intendedTitle = payload.title;
            if ((!newConv.title || newConv.title === 'Nuova Conversazione' || newConv.title === 'Conversazione senza titolo') && intendedTitle && intendedTitle !== newConv.title) {
                fetch(`${API_BASE}/conversations/${newConv.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: intendedTitle })
                }).catch(e => console.error("Force title update failed", e));
                // Optimistic update for UI
                newConv.title = intendedTitle;
            }

            setConversations([newConv, ...conversations]);
            setCurrentConversationId(newConv.id);
            setChatMessages([]);
            return newConv.id;
        } catch (error) {
            console.error('Failed to create conversation:', error);
            return null;
        }
    };

    const selectConversation = (id) => {
        setCurrentConversationId(id);
        loadMessages(id);
        setAiMode('chat'); // Switch to chat mode view
    };

    const deleteConversation = async (id, e) => {
        e.stopPropagation();
        if (!confirm('Eliminare questa conversazione?')) return;
        try {
            await fetch(`${API_BASE}/conversations/${id}`, { method: 'DELETE' });
            setConversations(conversations.filter(c => c.id !== id));
            if (currentConversationId === id) {
                setCurrentConversationId(null);
                setChatMessages([]);
            }
        } catch (error) {
            console.error('Failed to delete conversation:', error);
        }
    };

    // Helper to safely parse dates (handles SQLite "YYYY-MM-DD HH:MM:SS" format)
    const parseDate = (dateStr) => {
        if (!dateStr) return new Date();
        try {
            // Replace space with T for ISO format
            let safe = String(dateStr).trim().replace(' ', 'T');
            const d = new Date(safe);
            if (!isNaN(d.getTime())) return d;

            // Try appending Z if it looks like a UTC timestamp without offset
            if (safe.indexOf('T') > 0 && !safe.endsWith('Z') && !safe.includes('+')) {
                const dz = new Date(safe + 'Z');
                if (!isNaN(dz.getTime())) return dz;
            }
            return new Date(); // Fallback
        } catch (e) {
            return new Date();
        }
    };

    const callGeminiAgent = async (prompt, includeTools = false, imageBase64 = null, displayContent = null) => {
        setIsAiLoading(true);
        // Do NOT reset aiResponse here if we are appending to history
        // setAiResponse(''); 
        setLastAction(null);

        let activeConvId = currentConversationId;

        // Use provided display content or fallback to prompt (truncated if needed for display)
        const userContentToSave = displayContent || prompt;

        // --- Optimistic Update: User Message ---
        const userMsg = { sender: 'user', content: userContentToSave, timestamp: new Date().toISOString() };

        if (!activeConvId) {
            // Generate title from display content (more readable)
            let titleSource = userContentToSave;
            const title = titleSource.length > 30 ? titleSource.substring(0, 30) + '...' : titleSource;
            activeConvId = await createConversation(title || 'Nuova Analisi');
            // createConversation sets chatMessages to [], so we set it to [userMsg]
            setChatMessages([userMsg]);
        } else {
            // Append to existing
            setChatMessages(prev => [...prev, userMsg]);
        }

        // --- Background Save: User Message ---
        // We capture the promise but don't blocking wait immediately to allow parallel processing where possible,
        // but for safety we'll await it before saving AI response to keep order.
        const saveUserMsgPromise = fetch(`${API_BASE}/conversations/${activeConvId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender: 'user', content: userContentToSave })
        }).catch(err => console.error('Failed to save user message:', err));

        try {
            // Build parts array (text + optional image)
            const parts = [{ text: prompt }];
            if (imageBase64) {
                parts.push({
                    inline_data: {
                        mime_type: 'image/jpeg',
                        data: imageBase64
                    }
                });
            }

            // --- BUILD HISTORY FOR GEMINI ---
            const historyContents = chatMessages.map(m => ({
                role: m.sender === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            }));

            const payload = {
                contents: [
                    ...historyContents,
                    { role: 'user', parts }
                ],
                tools: includeTools ? [AQUARIUM_TOOLS] : undefined
            };

            const response = await fetch(`${API_BASE}/gemini`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await response.json();

            // Handle server-side errors
            if (data.error) {
                const msg = typeof data.error === 'object' ? JSON.stringify(data.error) : data.error;
                throw new Error(msg);
            }

            const responseParts = data.candidates?.[0]?.content?.parts || [];
            if (responseParts.length === 0) {
                console.error("Agent Error: No parts in response", data);
                throw new Error("Nessuna risposta valida dall'AI.");
            }

            let responseText = "";
            let functionExecuted = false;

            // Process text parts first to build the message
            const textParts = responseParts.filter(p => p.text).map(p => p.text).join('\n');
            if (textParts) responseText += textParts;

            // Process function calls
            const functionPart = responseParts.find(p => p.functionCall);
            if (functionPart) {
                const actionMessage = await performAgentAction(functionPart.functionCall);
                setLastAction(actionMessage);
                // Append the system action result to the response so the user knows it happened
                responseText += `\n\n✅ *Azione eseguita:* ${actionMessage}`;
                functionExecuted = true;
            } else if (!textParts) {
                responseText = "Nessuna risposta testuale.";
            }

            setAiResponse(responseText);

            // --- Optimistic Update: AI Message ---
            setChatMessages(prev => [...prev, { sender: 'ai', content: responseText, timestamp: new Date().toISOString() }]);

            // --- Background Save: AI Message ---
            // Ensure user message is saved first
            await saveUserMsgPromise;

            await fetch(`${API_BASE}/conversations/${activeConvId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender: 'ai', content: responseText })
            });

        } catch (error) {
            console.error("Agent Error:", error);
            const errorMsg = `Errore: ${error.message}`;
            setAiResponse(errorMsg);

            // Optimistic Error Msg
            setChatMessages(prev => [...prev, { sender: 'ai', content: errorMsg, timestamp: new Date().toISOString() }]);

            if (activeConvId) {
                await fetch(`${API_BASE}/conversations/${activeConvId}/messages`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sender: 'ai', content: errorMsg })
                });
            }

        } finally {
            setIsAiLoading(false);
        }
    };

    const handleRestartCamera = async () => {
        if (cameraRebooting) return;
        setCameraRebooting(true);
        setIsVideoLoading(true);
        try {
            await fetch(`${API_BASE}/tanks/${selectedTankId}/camera/restart`, { method: 'POST' });
            // Wait a moment for ffmpeg to restart
            setTimeout(() => {
                setCameraTimestamp(Date.now());
                setCameraRebooting(false);
            }, 2000);
        } catch (error) {
            console.error('Camera restart failed:', error);
            setCameraRebooting(false);
            setIsVideoLoading(false);
        }
    };

    const handleRunDiagnostics = () => {
        setAiMode('analysis');
        setIsAiModalOpen(true);

        // Capture current camera frame for visual analysis
        const cameraSnapshot = captureCameraFrame();

        const currentTank = tanks.find(t => t.id === selectedTankId);
        const tankName = currentTank?.name || `Tank ${selectedTankId}`;
        const tankVolume = currentTank?.volume ? `${currentTank.volume} Litri` : 'Sconosciuto';
        const tankType = currentTank?.water_type === 'marine' ? 'ACQUARIO MARINO' : 'ACQUARIO DOLCE';

        // Format Water Params for prompt
        const latestWater = waterParams[0] || {};
        const waterStr = waterParams.length > 0
            ? `\n      - NO2: ${latestWater.no2 ?? 'N/A'}\n      - NO3: ${latestWater.no3 ?? 'N/A'}\n      - NH3: ${latestWater.nh3 ?? 'N/A'}\n      - KH: ${latestWater.kh ?? 'N/A'}\n      - GH: ${latestWater.gh ?? 'N/A'}\n      - PO4: ${latestWater.po4 ?? 'N/A'}\n      - Fe: ${latestWater.fe ?? 'N/A'}`
            : "\n      - Parametri manuali non disponibili.";


        // Format Fish Inventory
        const fishStr = fishInventory.length > 0
            ? fishInventory.map(f => `      - ${f.quantity}x ${f.name} (${f.species})`).join('\n')
            : "      - Nessun pesce registrato.";

        // Format Plants Inventory
        const plantsStr = plantsInventory.length > 0
            ? plantsInventory.map(p => `      - ${p.quantity}x ${p.name} (${p.species}) [Stato: ${p.status}]`).join('\n')
            : "      - Nessuna pianta registrata.";

        const prompt = `Sei un esperto assistente di acquari. Analizza i dati per l'acquario "${tankName}" (Tipo: ${tankType}, Volume: ${tankVolume}).
      
      DATI SENSORI (Real-time):
      - Temperatura: ${sensors.temp}°C
      - pH: ${sensors.ph}
      - TDS: ${sensors.tds} ppm
      - Salinità: ${sensors.salinity || 'N/A'} SG
      - Livello acqua: ${sensors.level}%

      PARAMETRI ACQUA (Ultimo test manuale):${waterStr}

      POPOLAZIONE (Pesci):
${fishStr}

      PIANTE:
${plantsStr}

      EQUIPAGGIAMENTO:
      - Luce: ${currentTank?.light_watts || 'N/A'}W
      - Riscaldatore: ${currentTank?.heater_watts || 'N/A'}W

      Compiti:
      1. **ANALIZZA L'IMMAGINE**: Esamina visivamente l'acquario per torbidità, alghe, salute dei pesci/piante, sporcizia.
      2. Valuta la salute generale basandoti su parametri + osservazione visiva.
      3. Verifica la compatibilità dei pesci presenti con i valori attuali dell'acqua.
      4. Controlla se ci sono problemi di convivenza tra le specie elencate.
      5. Fornisci 3-5 suggerimenti pratici basati su dati E immagine.

      Rispondi in italiano con formattazione Markdown.`;

        callGeminiAgent(prompt, false, cameraSnapshot, "Diagnostica Completa");
    };

    const handleAskExpert = (e) => {
        e.preventDefault();
        if (!userQuery.trim()) return;
        setAiMode('chat');

        const currentTank = tanks.find(t => t.id === selectedTankId);
        const tankName = currentTank?.name || `Tank ${selectedTankId}`;
        const tankVolume = currentTank?.volume ? `${currentTank.volume} Litri` : 'Sconosciuto';
        const tankType = currentTank?.water_type === 'marine' ? 'ACQUARIO MARINO' : 'ACQUARIO DOLCE';

        // Format Water Params for prompt
        const latestWater = waterParams[0] || {};
        const waterStr = waterParams.length > 0
            ? `\n      - NO2: ${latestWater.no2 ?? 'N/A'}\n      - NO3: ${latestWater.no3 ?? 'N/A'}\n      - NH3: ${latestWater.nh3 ?? 'N/A'}\n      - KH: ${latestWater.kh ?? 'N/A'}\n      - GH: ${latestWater.gh ?? 'N/A'}\n      - PO4: ${latestWater.po4 ?? 'N/A'}\n      - Fe: ${latestWater.fe ?? 'N/A'}`
            : "\n      - Parametri manuali non disponibili.";

        // Format Fish Inventory
        const fishStr = fishInventory.length > 0
            ? fishInventory.map(f => `      - ${f.quantity}x ${f.name} (${f.species})`).join('\n')
            : "      - Nessun pesce registrato.";

        // Format Plants Inventory
        const plantsStr = plantsInventory.length > 0
            ? plantsInventory.map(p => `      - ${p.quantity}x ${p.name} (${p.species}) [Stato: ${p.status}]`).join('\n')
            : "      - Nessuna pianta registrata.";

        const context = `SEI UN ASSISTENTE ESPERTO DI ACQUARI. Stai analizzando l'acquario "${tankName}" (Tipo: ${tankType}, Volume: ${tankVolume}).
      
      STATO ATTUALE: 
      - Temperatura: ${sensors.temp}°C
      - pH: ${sensors.ph}
      - TDS: ${sensors.tds} ppm
      - Salinità: ${sensors.salinity || 'N/A'} SG
      - Livello: ${sensors.level}%
      
      DISPOSITIVI:
      - Luci Diurne: ${controls.mainLight ? 'ON' : 'OFF'}
      - Luci Lunari: ${controls.blueLight ? 'ON' : 'OFF'}
      - Pompa: ${controls.pump ? 'ON' : 'OFF'}
      - Skimmer: ${controls.skimmer ? 'ON' : 'OFF'}

      PARAMETRI CHIMICI MANUALI:${waterStr}

      POPOLAZIONE:${fishStr}

      PIANTE:${plantsStr}
      
      EQUIPAGGIAMENTO:
      - Luce: ${currentTank?.light_watts || 'N/A'}W
      - Riscaldatore: ${currentTank?.heater_watts || 'N/A'}W

      RICHIESTA UTENTE: ${userQuery}

      ISTRUZIONI AGGIUNTIVE:
      1. Se l'utente chiede una guida o una ricetta (es. per malattie), concentrati sulla procedura medica e SALVALA. NON proporre azioni ON/OFF sui dispositivi.
      2. STRUTTURA RICETTA OBBLIGATORIA: Le guide mediche DEVONO seguire esattamente questo schema:
         1) Sintomi(visivi e comportamentali) e Caratteristiche della malattia.
         2) Elenco Farmaci: separa chiaramente "Uso Umano" (es. Flagyl) da "Uso Acquariofilo" (es. Faunamor).
         3) Dosaggio dettagliato per OGNI farmaco elencato (mg/L, compresse/L, ecc).
         4) Durata del trattamento per ogni farmaco elencato.
         5) Pro e Contro di ogni opzione.
         6) Consigli pratici.
         
         FORMATTAZIONE MARKDOWN OBBLIGATORIA:
         - Usa ### per i titoli delle sezioni (es. ### 1. Sintomi e Caratteristiche)
         - Usa - per i bullet point (NON usare • o altri simboli)
         - Per liste annidate, usa 2 spazi di indentazione prima del trattino
         - Separa le sezioni principali con una riga vuota
         - Usa **grassetto** per i nomi dei farmaci
         - Usa backtick per dosaggi specifici (es. 80 gocce ogni 100L)
      3. Se l'utente chiede esplicitamente di controllare un dispositivo, usa set_device_state.

      Rispondi in italiano in modo cortese e professionale.`;

        callGeminiAgent(context, true, null, userQuery);
        setUserQuery('');
    };

    // ============== SCHEDULING HANDLERS ==============

    const deleteSchedule = async (id) => {
        try {
            await fetch(`${API_BASE}/schedules/${id}`, { method: 'DELETE' });
            setSchedules(schedules.filter(s => s.id !== id));
            // Refresh scheduled devices
            const devicesRes = await fetch(`${API_BASE}/schedules/active-devices`);
            setScheduledDevices(await devicesRes.json());
        } catch (error) {
            console.error('Delete schedule error:', error);
        }
    };

    const toggleScheduleActive = async (id, active) => {
        try {
            await fetch(`${API_BASE}/schedules/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: !active })
            });
            setSchedules(schedules.map(s => s.id === id ? { ...s, active: !active } : s));
            // Refresh scheduled devices
            const devicesRes = await fetch(`${API_BASE}/schedules/active-devices`);
            setScheduledDevices(await devicesRes.json());
        } catch (error) {
            console.error('Toggle schedule error:', error);
        }
    };

    // Start editing an existing schedule
    const startEditSchedule = (schedule) => {
        setEditingScheduleId(schedule.id);
        setNewSchedule({
            deviceId: schedule.deviceId,
            label: schedule.label,
            days: schedule.days,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            quantity: schedule.quantity || 1
        });
        setIsAddScheduleOpen(true);
    };

    // Save schedule (create or update)
    const saveSchedule = async () => {
        try {
            if (editingScheduleId) {
                // Update existing schedule
                const res = await fetch(`${API_BASE}/schedules/${editingScheduleId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...newSchedule, active: true, tankId: selectedTankId })
                });
                const data = await res.json();
                if (data.success) {
                    setSchedules(schedules.map(s => s.id === editingScheduleId ? { ...newSchedule, id: editingScheduleId, active: s.active } : s));
                }
            } else {
                // Create new schedule
                const res = await fetch(`${API_BASE}/schedules`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...newSchedule, tankId: selectedTankId })
                });
                const data = await res.json();
                if (data.success) {
                    setSchedules([...schedules, { ...newSchedule, id: data.id, active: true }]);
                }
            }

            // Refresh scheduled devices list
            const devicesRes = await fetch(`${API_BASE}/schedules/active-devices?tankId=${selectedTankId}`);
            const devices = await devicesRes.json();
            setScheduledDevices(devices);

            // Reset form
            setIsAddScheduleOpen(false);
            setEditingScheduleId(null);
            setNewSchedule({ deviceId: 'mainLight', label: '', days: [], startTime: '09:00', endTime: '17:00', quantity: 1 });
        } catch (error) {
            console.error('Save schedule error:', error);
        }
    };

    // Close modal and reset edit state
    const closeScheduleModal = () => {
        setIsAddScheduleOpen(false);
        setEditingScheduleId(null);
        setNewSchedule({ deviceId: 'mainLight', label: '', days: [], startTime: '09:00', endTime: '17:00', quantity: 1 });
    };

    const toggleDay = (dayIndex) => {
        const currentDays = newSchedule.days;
        if (currentDays.includes(dayIndex)) {
            setNewSchedule({ ...newSchedule, days: currentDays.filter(d => d !== dayIndex) });
        } else {
            setNewSchedule({ ...newSchedule, days: [...currentDays, dayIndex] });
        }
    };

    // ============== ALERT FUNCTIONS ==============
    const saveThreshold = async (threshold) => {
        try {
            const res = await fetch(`${API_BASE}/alerts/thresholds`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...threshold, tankId: selectedTankId })
            });
            if (res.ok) {
                const updated = await fetch(`${API_BASE}/alerts/thresholds?tankId=${selectedTankId}`).then(r => r.json());
                setAlertThresholds(updated);
            }
        } catch (err) {
            console.error('Save threshold error:', err);
        }
    };

    const deleteThreshold = async (id) => {
        try {
            await fetch(`${API_BASE}/alerts/thresholds/${id}`, { method: 'DELETE' });
            setAlertThresholds(alertThresholds.filter(t => t.id !== id));
        } catch (err) {
            console.error('Delete threshold error:', err);
        }
    };

    const saveNotificationSettings = async (settings = notificationSettings) => {
        try {
            await fetch(`${API_BASE}/alerts/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
        } catch (err) {
            console.error('Save notification settings error:', err);
        }
    };

    const testNotification = async () => {
        try {
            const res = await fetch(`${API_BASE}/alerts/test`, { method: 'POST' });
            const data = await res.json();
            alert(data.success ? 'Notifica di test inviata!' : 'Errore: ' + data.message);
        } catch (err) {
            alert('Errore invio notifica di test');
        }
    };

    const refreshAlertLog = async () => {
        const data = await fetch(`${API_BASE}/alerts/log?limit=50&tankId=${selectedTankId}`).then(r => r.json());
        setAlertLog(data);
    };

    const clearAlertLog = async () => {
        if (!confirm('Sei sicuro di voler eliminare tutto il log degli alert?')) return;
        try {
            await fetch(`${API_BASE}/alerts/log?tankId=${selectedTankId}`, { method: 'DELETE' });
            setAlertLog([]);
        } catch (error) {
            console.error('Clear alert log error:', error);
        }
    };

    const clearHistory = async (type = null) => {
        let confirmMsg = 'Sei sicuro di voler eliminare tutto lo storico dati?';
        let successMsg = 'Storico eliminato';

        if (type) {
            const labels = { temp: 'Temperatura', ph: 'pH', tds: 'TDS', level: 'Livello' };
            confirmMsg = `Vuoi eliminare SOLO lo storico di: ${labels[type]}?`;
            successMsg = `Storico ${labels[type]} pulito`;
        }

        if (!confirm(confirmMsg)) return;

        try {
            let url = `${API_BASE}/sensors/history?tankId=${selectedTankId}`;
            if (type) url += `&type=${type}`;

            await fetch(url, { method: 'DELETE' });

            // Reload history
            setHistoryRange(prev => {
                // Force refresh by toggling slightly or just recalling fetch
                // Ideally we call fetchHistory() but it's inside useEffect
                // We can trigger it by changing range then changing back or just reload page
                setTimeout(() => window.location.reload(), 500); // Simple reload to reflect changes
                return prev;
            });
            alert(successMsg);
        } catch (error) {
            console.error('Clear history error:', error);
        }
    };

    const fetchHistoryLog = async () => {
        try {
            const res = await fetch(`${API_BASE}/sensors/history/log?limit=50&tankId=${selectedTankId}`);
            const data = await res.json();
            setHistoryLog(data);
        } catch (error) {
            console.error('Fetch history log error:', error);
        }
    };

    const deleteHistoryItem = async (id) => {
        if (!confirm('Eliminare questo record?')) return;
        try {
            await fetch(`${API_BASE}/sensors/history/${id}`, { method: 'DELETE' });
            setHistoryLog(historyLog.filter(item => item.id !== id));
            // Trigger chart refresh
            setHistoryRange(prev => prev); // Valid hack to re-trigger effect
        } catch (error) {
            console.error('Delete history item error:', error);
        }
    };

    // ============== CHIHIROS LED FUNCTIONS ==============
    const scanChihirosDevices = async () => {
        setIsScanning(true);
        try {
            const res = await fetch(`${API_BASE}/chihiros/scan`);
            const data = await res.json();
            if (data.success && data.devices) {
                // Show all devices found (user can select which to add)
                setChihirosScanResults(data.devices);
            }
        } catch (error) {
            console.error('Scan error:', error);
        } finally {
            setIsScanning(false);
        }
    };

    const addChihirosDevice = async (device) => {
        try {
            const res = await fetch(`${API_BASE}/chihiros/devices`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...device, tankId: selectedTankId })
            });
            if (res.ok) {
                // Refresh device list
                const devices = await fetch(`${API_BASE}/chihiros/devices?tankId=${selectedTankId}`).then(r => r.json());
                setChihirosDevices(devices);
                setShowAddLampModal(false);
            }
        } catch (error) {
            console.error('Add device error:', error);
        }
    };

    const removeChihirosDevice = async (id) => {
        try {
            await fetch(`${API_BASE}/chihiros/devices/${id}`, { method: 'DELETE' });
            setChihirosDevices(chihirosDevices.filter(d => d.id !== id));
        } catch (error) {
            console.error('Remove device error:', error);
        }
    };

    const controlChihiros = async (id, action, params = {}) => {
        try {
            let endpoint = `${API_BASE}/chihiros/devices/${id}/${action}`;
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });
            if (res.ok) {
                // Refresh device list to get updated state
                const devices = await fetch(`${API_BASE}/chihiros/devices?tankId=${selectedTankId}`).then(r => r.json());
                setChihirosDevices(devices);
            }
        } catch (error) {
            console.error('Control error:', error);
        }
    };

    // Debounced brightness control - waits 300ms before sending
    const setBrightnessDebounced = (id, brightness) => {
        // Update local state immediately for responsive UI
        setPendingBrightness(prev => ({ ...prev, [id]: brightness }));

        // Clear existing timer
        if (brightnessDebounceRef.current[id]) {
            clearTimeout(brightnessDebounceRef.current[id]);
        }

        // Set new timer
        brightnessDebounceRef.current[id] = setTimeout(() => {
            controlChihiros(id, 'brightness', { brightness });
            // Clear pending state after sending
            setPendingBrightness(prev => {
                const newState = { ...prev };
                delete newState[id];
                return newState;
            });
        }, 300);
    };

    // ============== DISCOVERY FUNCTIONS ==============
    const scanForDevices = async () => {
        setIsScanningDevices(true);
        setDiscoveredDevices([]);
        try {
            const res = await fetch(`${API_BASE}/discovery`);
            const data = await res.json();
            if (data.success) {
                setDiscoveredDevices(data.devices);
            }
        } catch (error) {
            console.error('Discovery error:', error);
        } finally {
            setIsScanningDevices(false);
        }
    };

    // ============== TANK FUNCTIONS ==============
    // Create new tank
    // Create or Update tank
    const handleAddTank = async (e) => {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const tankName = formData.get('tankName');
        const tankType = formData.get('tankType');
        const tankAddress = formData.get('tankAddress');
        const cameraUrl = formData.get('cameraUrl');
        const waterType = formData.get('waterType');

        try {
            const url = editingTank ? `${API_BASE}/tanks/${editingTank.id}` : `${API_BASE}/tanks`;
            const method = editingTank ? 'PUT' : 'POST';

            const width = parseFloat(formData.get('width')) || null;
            const height = parseFloat(formData.get('height')) || null;
            const depth = parseFloat(formData.get('depth')) || null;
            const volume = parseFloat(formData.get('volume')) || null;
            const light_watts = parseFloat(formData.get('light_watts')) || null;
            const heater_watts = parseFloat(formData.get('heater_watts')) || null;

            // Camera params removed from here (handled in settings menu)

            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: tankName,
                    type: tankType,
                    address: tankAddress,
                    camera_url: cameraUrl,
                    width, height, depth, volume,
                    water_type: waterType,
                    light_watts, heater_watts
                })
            });
            const data = await res.json();
            if (data.success) {
                // Refresh tanks
                const tanksRes = await fetch(`${API_BASE}/tanks`);
                const tanksData = await tanksRes.json();
                setTanks(tanksData);
                if (!editingTank) setSelectedTankId(data.id); // Switch to new tank only if adding
                setIsAddTankModalOpen(false);
                setEditingTank(null); // Reset
            }
        } catch (err) {
            console.error('Save tank error:', err);
        }
    };



    // Export tank backup
    const handleExportTank = async () => {
        try {
            const res = await fetch(`${API_BASE}/tanks/${selectedTankId}/export`);
            if (!res.ok) throw new Error('Errore durante l\'esportazione');
            const data = await res.json();

            // Download as JSON file
            const tankName = tanks.find(t => t.id === selectedTankId)?.name || 'tank';
            const filename = `${tankName.replace(/\s+/g, '_')}_backup_${new Date().toISOString().split('T')[0]}.json`;
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            alert('Backup esportato con successo!');
        } catch (err) {
            console.error('Export error:', err);
            alert('Errore durante l\'esportazione del backup');
        }
    };

    // Import tank backup
    const handleImportTank = async (backupData) => {
        if (!confirm('Importare questo backup? ATTENZIONE: Tutti i dati attuali della vasca selezionata verranno sostituiti!')) return;

        try {
            const res = await fetch(`${API_BASE}/tanks/${selectedTankId}/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(backupData)
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || 'Errore durante l\'importazione');
            }

            const result = await res.json();
            alert(result.message || 'Backup importato con successo!');

            // Reload page data
            window.location.reload();
        } catch (err) {
            console.error('Import error:', err);
            alert('Errore durante l\'importazione: ' + err.message);
        }
    };

    // Delete tank
    const handleDeleteTank = async (id) => {
        if (!confirm('Sei sicuro di voler eliminare questo acquario? Tutti i dati verranno persi.')) return;

        try {
            const res = await fetch(`${API_BASE}/tanks/${id}`, { method: 'DELETE' });
            if (res.ok) {
                // Refresh
                const tanksRes = await fetch(`${API_BASE}/tanks`);
                const tanksData = await tanksRes.json();
                setTanks(tanksData);
                if (selectedTankId === id) setSelectedTankId(1); // Reset to main if deleted
            } else {
                alert('Errore eliminazione acquario');
            }
        } catch (err) {
            console.error('Delete tank error:', err);
        }
    };

    // ============== FULLSCREEN TOGGLE ==============
    const toggleFullscreen = useCallback(() => {
        if (!videoContainerRef.current) return;

        if (!document.fullscreenElement) {
            videoContainerRef.current.requestFullscreen().then(() => {
                setIsFullscreen(true);
            }).catch(err => {
                console.error('Fullscreen error:', err);
            });
        } else {
            document.exitFullscreen().then(() => {
                setIsFullscreen(false);
            });
        }
    }, []);

    // Listen for fullscreen changes
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    // ============== CAMERA SETTINGS ==============
    const updateCameraSettings = async (newSettings) => {
        try {
            const res = await fetch(`${API_BASE}/camera/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newSettings)
            });
            const data = await res.json();
            if (data.success) {
                setCameraSettings(prev => ({ ...prev, ...data.settings }));
                // Force reload stream
                const streamImg = document.querySelector('img[alt="Aquarium Live Feed"]');
                if (streamImg) {
                    streamImg.src = `${API_BASE}/stream?t=${Date.now()}`;
                }
            }
        } catch (error) {
            console.error('Camera settings error:', error);
        }
    };

    const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    const deviceOptions = [
        { id: 'mainLight', name: 'Luci Diurne', icon: 'light' },
        { id: 'blueLight', name: 'Luci Lunari', icon: 'light' },
        { id: 'pump', name: 'Pompa', icon: 'pump' },
        { id: 'skimmer', name: 'Skimmer', icon: 'pump' },
        { id: 'feeder', name: 'Mangiatoia', icon: 'feeder' },
    ];

    return (
        <div className="h-screen bg-slate-900 text-slate-100 font-sans selection:bg-cyan-500 selection:text-white flex flex-col overflow-hidden relative">

            {/* --- AI MODAL --- */}
            {isAiModalOpen && (
                <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-slate-800 w-full max-w-6xl rounded-2xl shadow-2xl border border-cyan-500/30 flex h-[85vh] overflow-hidden">

                        {/* LEFT SIDEBAR: History */}
                        <div className={`w-72 bg-slate-900/80 border-r border-slate-700 flex-col md:flex ${isMobileHistoryOpen ? 'flex absolute inset-0 z-50 w-full bg-slate-900' : 'hidden'}`}>
                            <div className="p-4 border-b border-slate-700 bg-slate-900 flex justify-between items-center">
                                {/* Close Button for Mobile */}
                                {isMobileHistoryOpen && (
                                    <button onClick={() => setIsMobileHistoryOpen(false)} className="md:hidden mr-2 p-2 hover:bg-slate-800 rounded-lg text-slate-400">
                                        <ChevronLeft size={20} />
                                    </button>
                                )}
                                <button
                                    onClick={() => { setCurrentConversationId(null); setChatMessages([]); setAiMode('analysis'); }}
                                    className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-cyan-900/20"
                                >
                                    <Plus size={18} /> Nuova Chat
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                                <div className="flex justify-between items-center mb-2 px-1">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cronologia</h4>
                                    <button
                                        onClick={loadConversations}
                                        className="text-slate-500 hover:text-cyan-400 transition-colors"
                                        title="Ricarica elenco"
                                    >
                                        <RefreshCw size={12} />
                                    </button>
                                </div>
                                {conversations.map(c => (
                                    <div key={c.id}
                                        onClick={() => selectConversation(c.id)}
                                        className={`group relative p-3 rounded-xl cursor-pointer transition-all border ${currentConversationId === c.id ? 'bg-slate-800 border-cyan-500/50 shadow-md' : 'hover:bg-slate-800 border-transparent hover:border-slate-700'}`}
                                    >
                                        <h4 className={`font-medium text-sm truncate pr-6 ${currentConversationId === c.id ? 'text-cyan-400' : 'text-slate-300'}`}>
                                            {c.title || 'Conversazione senza titolo'}
                                        </h4>
                                        <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                                            <Calendar size={10} /> {parseDate(c.updated_at).toLocaleDateString()}
                                            <span className="opacity-50">|</span>
                                            {parseDate(c.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                        <button
                                            onClick={(e) => deleteConversation(c.id, e)}
                                            className="absolute right-2 top-3 p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all bg-slate-800/80 rounded"
                                            title="Elimina conversazione"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                                {conversations.length === 0 && (
                                    <div className="text-center py-8 opacity-50 flex flex-col items-center">
                                        <MessageSquare className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                                        <p className="text-slate-500 text-xs mb-2">Nessuna conversazione salvata</p>
                                        <button onClick={loadConversations} className="text-cyan-500 text-xs hover:underline">Riprova</button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* RIGHT MAIN: Chat Area */}
                        <div className="flex-1 flex flex-col bg-slate-800 relative">
                            {/* Header */}
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/95 backdrop-blur z-10 shadow-sm">
                                <div className="flex items-center gap-2 md:gap-3">
                                    {/* Mobile History Toggle */}
                                    <button onClick={() => setIsMobileHistoryOpen(!isMobileHistoryOpen)} className="md:hidden p-2 hover:bg-slate-700 rounded-lg text-slate-400">
                                        <History size={20} />
                                    </button>
                                    <div className="bg-cyan-500/10 p-2 rounded-lg">
                                        <Sparkles className="w-5 h-5 text-cyan-400 animate-pulse" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                                            AquaMind <span className="text-cyan-400">Assistant</span>
                                            <span className="text-[10px] bg-slate-700 px-2 py-0.5 rounded text-slate-300 font-normal ml-2">ID: {selectedTankId}</span>
                                        </h3>
                                        <p className="text-xs text-slate-400 hidden sm:block">
                                            {currentConversationId ? conversations.find(c => c.id === currentConversationId)?.title : 'Nuova Sessione'}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* Mobile Menu Toggle (Simplified) */}
                                    <button onClick={() => setIsAiModalOpen(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                                        <X className="w-6 h-6" />
                                    </button>
                                </div>
                            </div>

                            {/* Chat Content */}
                            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 custom-scrollbar bg-slate-900/30">
                                {chatMessages && chatMessages.length > 0 ? (
                                    <>
                                        {chatMessages.map((msg, idx) => {
                                            if (!msg) return null;
                                            return (
                                                <div key={idx} className={`flex w-full ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                    <div className={`flex flex-col max-w-[90%] md:max-w-[75%] ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                                                        <div className={`px-5 py-4 shadow-lg ${msg.sender === 'user'
                                                            ? 'bg-gradient-to-br from-cyan-600 to-cyan-700 text-white rounded-2xl rounded-tr-sm'
                                                            : 'bg-slate-700 text-slate-200 rounded-2xl rounded-tl-sm border border-slate-600'
                                                            }`}>
                                                            <SimpleMarkdownRenderer content={msg.content || ''} />
                                                        </div>
                                                        <span className="text-[10px] text-slate-500 mt-1 px-1">
                                                            {parseDate(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {isAiLoading && (
                                            <div className="flex justify-start w-full">
                                                <div className="bg-slate-700/50 text-slate-300 px-5 py-3 rounded-2xl rounded-tl-sm border border-slate-600/50 flex items-center gap-3 shadow-inner">
                                                    <Loader className="w-4 h-4 animate-spin text-cyan-400" />
                                                    <span className="text-sm font-medium animate-pulse">Sto elaborando...</span>
                                                </div>
                                            </div>
                                        )}
                                        <div ref={responseEndRef} />
                                    </>
                                ) : (
                                    /* Empty State / Dashboard */
                                    <div className="h-full flex flex-col items-center justify-center p-4">
                                        <div className="max-w-md w-full text-center space-y-8">
                                            <div className="bg-slate-800/50 p-8 rounded-3xl border border-slate-700/50 shadow-xl">
                                                <div className="w-20 h-20 bg-slate-700/50 rounded-full flex items-center justify-center mx-auto mb-6 relative">
                                                    <Sparkles className="w-10 h-10 text-cyan-400" />
                                                    <div className="absolute inset-0 border-2 border-cyan-500/20 rounded-full animate-ping opacity-20"></div>
                                                </div>

                                                <h2 className="text-2xl font-bold text-slate-100 mb-2">Come posso aiutarti?</h2>
                                                <p className="text-slate-400 text-sm mb-8">
                                                    Eseguo diagnostica completa sui parametri dell'acqua, analizzo la salute visiva dell'acquario e rispondo alle tue domande tecniche.
                                                </p>

                                                <div className="grid grid-cols-1 gap-4">
                                                    <button
                                                        onClick={handleRunDiagnostics}
                                                        disabled={isAiLoading}
                                                        className="group relative overflow-hidden bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white p-4 rounded-xl font-bold shadow-lg shadow-cyan-900/20 transition-all active:scale-[0.98]"
                                                    >
                                                        <div className="flex items-center justify-center gap-3 relative z-10">
                                                            <Activity className="w-5 h-5" />
                                                            <span>Avvia Diagnostica Completa</span>
                                                        </div>
                                                        <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                                                    </button>

                                                    <div className="relative">
                                                        <div className="absolute inset-0 flex items-center">
                                                            <div className="w-full border-t border-slate-700"></div>
                                                        </div>
                                                        <div className="relative flex justify-center text-xs uppercase">
                                                            <span className="bg-slate-800/50 px-2 text-slate-500">Oppure chiedi</span>
                                                        </div>
                                                    </div>

                                                    <form onSubmit={handleAskExpert} className="relative">
                                                        <input
                                                            type="text"
                                                            value={userQuery}
                                                            onChange={(e) => setUserQuery(e.target.value)}
                                                            placeholder="Es: 'Perché il pH è basso?'"
                                                            className="w-full bg-slate-900 border border-slate-600 rounded-xl pl-4 pr-12 py-4 text-slate-200 focus:border-cyan-500 outline-none transition-colors shadow-inner"
                                                        />
                                                        <button
                                                            type="submit"
                                                            disabled={isAiLoading || !userQuery.trim()}
                                                            className="absolute right-2 top-2 bottom-2 aspect-square bg-slate-700 hover:bg-cyan-600 text-slate-300 hover:text-white rounded-lg flex items-center justify-center transition-all disabled:opacity-50 disabled:hover:bg-slate-700"
                                                        >
                                                            <Send className="w-5 h-5" />
                                                        </button>
                                                    </form>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Chat Input Footer */}
                            {chatMessages && chatMessages.length > 0 && (
                                <div className="p-4 border-t border-slate-700 bg-slate-800/95 backdrop-blur z-10 shrink-0">
                                    <form onSubmit={handleAskExpert} className="relative flex items-center gap-2 max-w-4xl mx-auto w-full">
                                        <div className="relative flex-1">
                                            <input
                                                type="text"
                                                value={userQuery}
                                                onChange={(e) => setUserQuery(e.target.value)}
                                                placeholder="Scrivi un messaggio..."
                                                className="w-full bg-slate-900 border border-slate-600 rounded-xl pl-4 pr-4 py-3 text-slate-200 focus:border-cyan-500 outline-none transition-colors shadow-inner"
                                                disabled={isAiLoading}
                                            />
                                        </div>
                                        <button
                                            type="submit"
                                            disabled={isAiLoading || !userQuery.trim()}
                                            className="p-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl transition-all disabled:opacity-50 disabled:bg-slate-700 shadow-lg shadow-cyan-900/20 hover:scale-105 active:scale-95"
                                        >
                                            <Send className="w-5 h-5" />
                                        </button>
                                    </form>
                                </div>
                            )}


                        </div>
                    </div>
                </div>
            )
            }

            {/* --- HISTORY MANAGEMENT MODAL --- */}
            {
                isHistoryModalOpen && (
                    <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="bg-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-700 flex flex-col max-h-[80vh]">
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800 rounded-t-2xl">
                                <div className="flex items-center gap-2">
                                    <Activity className="w-5 h-5 text-cyan-400" />
                                    <h3 className="font-bold text-lg text-slate-100">
                                        Gestione Storico
                                        <span className="ml-2 text-xs text-slate-500 font-normal opacity-50">(Tank ID: {selectedTankId})</span>
                                    </h3>
                                    <button
                                        onClick={fetchHistoryLog}
                                        className="p-1.5 ml-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
                                        title="Ricarica storico"
                                    >
                                        <RefreshCw size={16} />
                                    </button>
                                </div>
                                <button onClick={() => setIsHistoryModalOpen(false)} className="p-2 hover:bg-slate-700 rounded-lg">
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-0 custom-scrollbar">
                                <table className="w-full text-left text-sm text-slate-400">
                                    <thead className="bg-slate-900/50 text-xs uppercase font-medium text-slate-500 sticky top-0 backdrop-blur-md z-10">
                                        <tr>
                                            <th className="px-4 py-3">Timestamp</th>
                                            <th className="px-4 py-3 text-right">Temp</th>
                                            <th className="px-4 py-3 text-right">pH</th>
                                            <th className="px-4 py-3 text-right">TDS</th>
                                            <th className="px-4 py-3 text-right">Livello</th>
                                            <th className="px-4 py-3 text-center">Azioni</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/50">
                                        {historyLog.map(item => (
                                            <tr key={item.id} className="hover:bg-slate-700/30 transition-colors">
                                                <td className="px-4 py-3 font-mono">{new Date(item.timestamp).toLocaleString('it-IT')}</td>
                                                <td className="px-4 py-3 text-right text-slate-200">{item.temp?.toFixed(1) || '-'}°C</td>
                                                <td className="px-4 py-3 text-right text-slate-200">{item.ph?.toFixed(2) || '-'}</td>
                                                <td className="px-4 py-3 text-right text-slate-200">{item.tds?.toFixed(0) || '-'}</td>
                                                <td className="px-4 py-3 text-right text-slate-200">{item.level}%</td>
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        onClick={() => deleteHistoryItem(item.id)}
                                                        className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                                                        title="Elimina singolo record"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {historyLog.length === 0 && (
                                    <div className="p-8 text-center text-slate-500">
                                        Nessun dato registrato.
                                    </div>
                                )}
                            </div>
                            <div className="p-4 border-t border-slate-700 bg-slate-800 rounded-b-2xl flex justify-between items-center">
                                <span className="text-xs text-slate-500">Mostrati ultimi 50 record</span>
                                <button
                                    onClick={clearHistory}
                                    className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded-lg border border-red-500/30 transition-colors flex items-center gap-2"
                                >
                                    <Trash2 size={12} /> Elimina Tutto
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* --- BACKUP MODAL --- */}
            {
                isBackupModalOpen && (
                    <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
                        <div className="bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl border border-slate-600">
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                                <h3 className="font-bold text-slate-100 flex items-center gap-2">📥 Esporta Backup</h3>
                                <button onClick={() => setIsBackupModalOpen(false)}>
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                <p className="text-sm text-slate-400">Seleziona i dati da includere nel backup:</p>
                                <div className="space-y-2">
                                    {[
                                        { id: 'config', label: 'Configurazione (Device, Soglie)' },
                                        { id: 'schedules', label: 'Programmazione' },
                                        { id: 'livestock', label: 'Pesci & Vivo' },
                                        { id: 'history', label: 'Storico Dati & Log' }
                                    ].map(opt => (
                                        <label key={opt.id} className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg cursor-pointer hover:bg-slate-900 transition-colors">
                                            <input
                                                type="checkbox"
                                                className="w-5 h-5 rounded border-slate-600 text-cyan-500 focus:ring-cyan-500 bg-slate-800"
                                                checked={backupSelection[opt.id]}
                                                onChange={e => setBackupSelection({ ...backupSelection, [opt.id]: e.target.checked })}
                                            />
                                            <span className="text-sm font-medium text-slate-200">{opt.label}</span>
                                        </label>
                                    ))}
                                </div>
                                <button
                                    onClick={() => {
                                        const include = Object.keys(backupSelection).filter(k => backupSelection[k]).join(',');
                                        window.open(`${API_BASE}/backup?tankId=${selectedTankId}&include=${include}`, '_blank');
                                        setIsBackupModalOpen(false);
                                    }}
                                    className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold transition-colors flex justify-center items-center gap-2"
                                >
                                    <Download className="w-4 h-4" /> Scarica Backup
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* --- LEVEL CALIBRATION MODAL --- */}
            {
                isLevelCalibrationOpen && (
                    <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
                        <div className="bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl border border-slate-600">
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                                <h3 className="font-bold text-slate-100 flex items-center gap-2">📏 Calibrazione Livello</h3>
                                <button onClick={() => setIsLevelCalibrationOpen(false)}>
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-lg mb-4">
                                    <p className="text-xs text-cyan-300">
                                        Configura le distanze per il calcolo del livello.
                                    </p>
                                </div>

                                <div>
                                    <label className="text-xs text-slate-400 uppercase font-bold block mb-2">Distanza Minima (100% Pieno)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-cyan-500"
                                        value={levelConfig.minDistance}
                                        onChange={e => setLevelConfig({ ...levelConfig, minDistance: parseFloat(e.target.value) })}
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">Distanza in cm tra il sensore e l'acqua quando il serbatoio è PIENO.</p>
                                </div>

                                <div>
                                    <label className="text-xs text-slate-400 uppercase font-bold block mb-2">Distanza Massima (0% Vuoto)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-cyan-500"
                                        value={levelConfig.maxDistance}
                                        onChange={e => setLevelConfig({ ...levelConfig, maxDistance: parseFloat(e.target.value) })}
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">Distanza in cm tra il sensore e il fondo (o livello minimo) quando è VUOTO.</p>
                                </div>

                                <button
                                    onClick={async () => {
                                        if (!confirm('Vuoi resettare i parametri di livello a default (5cm - 15cm)?')) return;
                                        try {
                                            const res = await fetch(`${API_BASE}/tanks/${selectedTankId}`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ min_distance: 5.0, max_distance: 15.0 })
                                            });
                                            if (res.ok) {
                                                alert('Reset completato!');
                                                setIsLevelCalibrationOpen(false);
                                                const updated = tanks.map(t => t.id === selectedTankId ? { ...t, min_distance: 5.0, max_distance: 15.0 } : t);
                                                setTanks(updated);
                                            }
                                        } catch (e) { console.error(e); alert('Errore reset'); }
                                    }}
                                    className="w-full py-3 mb-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
                                >
                                    <RotateCcw size={16} /> Reset Default
                                </button>
                                <button
                                    onClick={async () => {
                                        try {
                                            const res = await fetch(`${API_BASE}/tanks/${selectedTankId}`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    min_distance: levelConfig.minDistance,
                                                    max_distance: levelConfig.maxDistance
                                                })
                                            });
                                            if (res.ok) {
                                                alert('Configurazione salvata!');
                                                setIsLevelCalibrationOpen(false);
                                                // Trigger refresh or optimistic update
                                                const updatedTanks = tanks.map(t =>
                                                    t.id === selectedTankId ? { ...t, min_distance: levelConfig.minDistance, max_distance: levelConfig.maxDistance } : t
                                                );
                                                setTanks(updatedTanks);
                                            } else {
                                                alert('Errore salvataggio');
                                            }
                                        } catch (err) {
                                            console.error(err);
                                            alert('Errore di connessione');
                                        }
                                    }}
                                    className="w-full py-3 mt-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl font-semibold transition-colors shadow-lg shadow-cyan-900/20"
                                >
                                    Salva Configurazione
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* --- PH CALIBRATION WIZARD --- */}
            {
                isPhCalibrationOpen && (
                    <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
                        <div className="bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl border border-slate-600 flex flex-col max-h-[90vh]">
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center shrink-0">
                                <h3 className="font-bold text-slate-100 flex items-center gap-2">🧪 Calibrazione pH Guidata</h3>
                                <button onClick={() => setIsPhCalibrationOpen(false)}>
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                            </div>
                            <div className="p-6 space-y-6 overflow-y-auto">
                                {/* Step 1: Input Buffer */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-cyan-900 text-cyan-400 flex items-center justify-center font-bold">1</div>
                                        <h4 className="text-slate-200 font-semibold">Prepara Soluzione Buffer</h4>
                                    </div>
                                    <p className="text-sm text-slate-400 ml-11">
                                        Pulisci la sonda e immergila nella soluzione di calibrazione.
                                        Inserisci qui sotto il valore della soluzione (es. 7.00).
                                    </p>
                                    <div className="ml-11">
                                        <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Valore Buffer Target</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-cyan-500"
                                            placeholder="7.00"
                                            defaultValue={7.00}
                                            id="phTargetInput"
                                        />
                                    </div>
                                </div>

                                {/* Step 2: Live Reading & Calc */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-cyan-900 text-cyan-400 flex items-center justify-center font-bold">2</div>
                                        <h4 className="text-slate-200 font-semibold">Misurazione in Corso</h4>
                                    </div>
                                    <div className="ml-11 bg-slate-900 p-4 rounded-xl border border-slate-700 flex justify-between items-center">
                                        <div>
                                            <div className="text-xs text-slate-500 uppercase">Lettura Attuale</div>
                                            <div className="text-2xl font-bold text-cyan-400">{sensors.ph}</div>
                                        </div>
                                        <ArrowRight className="text-slate-600" />
                                        <div className="text-right">
                                            <div className="text-xs text-slate-500 uppercase">Nuovo Offset Stis</div>
                                            {/* Calc preview logic could go here, but we do it on save */}
                                            <div className="text-sm text-slate-400">Calcolato al salvataggio</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Action */}
                                <button
                                    onClick={async () => {
                                        if (!confirm('Vuoi resettare la calibrazione pH (Offset 0.0)?')) return;
                                        try {
                                            const res = await fetch(`${API_BASE}/tanks/${selectedTankId}`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ ph_offset: 0.0 })
                                            });
                                            if (res.ok) {
                                                alert('Reset completato!');
                                                setIsPhCalibrationOpen(false);
                                                const updated = tanks.map(t => t.id === selectedTankId ? { ...t, ph_offset: 0.0 } : t);
                                                setTanks(updated);
                                            }
                                        } catch (e) { console.error(e); alert('Errore reset'); }
                                    }}
                                    className="w-full py-3 mb-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
                                >
                                    <RotateCcw size={16} /> Reset Default
                                </button>
                                <button
                                    onClick={async () => {
                                        try {
                                            const targetVal = parseFloat(document.getElementById('phTargetInput').value);
                                            if (isNaN(targetVal)) return alert("Inserisci un valore valido");

                                            // Logic: NewOffset = Target - (CurrentReading - OldOffset)
                                            // But wait, server sends 'ph' which is (Raw + OldOffset).
                                            // So Raw = CurrentReading - OldOffset.
                                            // NewOffset = Target - Raw.
                                            const t = tanks.find(tank => tank.id === selectedTankId);
                                            const oldOffset = t?.ph_offset || 0.0;
                                            const currentVal = parseFloat(sensors.ph);

                                            const rawVal = currentVal - oldOffset;
                                            const newOffset = targetVal - rawVal;

                                            const res = await fetch(`${API_BASE}/tanks/${selectedTankId}`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ ph_offset: newOffset })
                                            });

                                            if (res.ok) {
                                                alert(`Calibrazione completata!\nNuovo Offset: ${newOffset.toFixed(2)} (Era: ${oldOffset.toFixed(2)})`);
                                                setIsPhCalibrationOpen(false);
                                                const updated = tanks.map(tk => tk.id === selectedTankId ? { ...tk, ph_offset: newOffset } : tk);
                                                setTanks(updated);
                                            } else alert('Errore salvataggio');
                                        } catch (err) { console.error(err); alert('Errore'); }
                                    }}
                                    className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl font-semibold transition-colors shadow-lg shadow-cyan-900/20"
                                >
                                    Calcola & Salva
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* --- TDS CALIBRATION WIZARD --- */}
            {
                isTdsCalibrationOpen && (
                    <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
                        <div className="bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl border border-slate-600 flex flex-col max-h-[90vh]">
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center shrink-0">
                                <h3 className="font-bold text-slate-100 flex items-center gap-2">💧 Calibrazione TDS Guidata</h3>
                                <button onClick={() => setIsTdsCalibrationOpen(false)}>
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                            </div>
                            <div className="p-6 space-y-6 overflow-y-auto">
                                {/* Step 1: Input Buffer */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-cyan-900 text-cyan-400 flex items-center justify-center font-bold">1</div>
                                        <h4 className="text-slate-200 font-semibold">Prepara Soluzione Buffer</h4>
                                    </div>
                                    <p className="text-sm text-slate-400 ml-11">
                                        Immergi la sonda nella soluzione (es. 1413 µS/cm ≈ 707 ppm).
                                        Inserisci il valore target in PPM.
                                    </p>
                                    <div className="ml-11">
                                        <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Valore TDS Target (ppm)</label>
                                        <input
                                            type="number"
                                            step="1"
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-cyan-500"
                                            placeholder="707"
                                            defaultValue={707}
                                            id="tdsTargetInput"
                                        />
                                    </div>
                                </div>

                                {/* Step 2: Live Reading */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-cyan-900 text-cyan-400 flex items-center justify-center font-bold">2</div>
                                        <h4 className="text-slate-200 font-semibold">Lettura Attuale</h4>
                                    </div>
                                    <div className="ml-11 bg-slate-900 p-4 rounded-xl border border-slate-700 flex justify-between items-center">
                                        <div>
                                            <div className="text-xs text-slate-500 uppercase">Sensore</div>
                                            <div className="text-2xl font-bold text-amber-400">{sensors.tds} <span className="text-sm text-slate-500">ppm</span></div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs text-slate-500 uppercase">K Attuale</div>
                                            <div className="text-sm text-slate-300 font-mono">
                                                {tanks.find(t => t.id === selectedTankId)?.tds_k_value?.toFixed(2) || '1.00'}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Action */}
                                <button
                                    onClick={async () => {
                                        if (!confirm('Vuoi resettare la calibrazione TDS (K=1.0)?')) return;
                                        try {
                                            const res = await fetch(`${API_BASE}/tanks/${selectedTankId}`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ tds_k_value: 1.0 })
                                            });
                                            if (res.ok) {
                                                alert('Reset completato!');
                                                setIsTdsCalibrationOpen(false);
                                                const updated = tanks.map(t => t.id === selectedTankId ? { ...t, tds_k_value: 1.0 } : t);
                                                setTanks(updated);
                                            }
                                        } catch (e) { console.error(e); alert('Errore reset'); }
                                    }}
                                    className="w-full py-3 mb-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
                                >
                                    <RotateCcw size={16} /> Reset Default
                                </button>
                                <button
                                    onClick={async () => {
                                        try {
                                            const targetVal = parseFloat(document.getElementById('tdsTargetInput').value);
                                            if (isNaN(targetVal) || targetVal <= 0) return alert("Inserisci un valore valido");

                                            // Logic: NewK = (Target / CurrentReading) * OldK
                                            // Explanation: CurrentReading = Raw * OldK.
                                            // We want Target = Raw * NewK.
                                            // So Raw = CurrentReading / OldK
                                            // NewK = Target / (CurrentReading / OldK) = (Target / CurrentReading) * OldK.

                                            const t = tanks.find(tank => tank.id === selectedTankId);
                                            const oldK = t?.tds_k_value || 1.0;
                                            const currentVal = parseFloat(sensors.tds);

                                            if (currentVal <= 0) {
                                                alert("Lettura sensore a 0. Impossibile calibrare.");
                                                return;
                                            }

                                            const newK = (targetVal / currentVal) * oldK;

                                            const res = await fetch(`${API_BASE}/tanks/${selectedTankId}`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ tds_k_value: newK })
                                            });

                                            if (res.ok) {
                                                alert(`Calibrazione completata!\nNuovo Fattore K: ${newK.toFixed(3)} (Era: ${oldK.toFixed(3)})`);
                                                setIsTdsCalibrationOpen(false);
                                                const updated = tanks.map(tk => tk.id === selectedTankId ? { ...tk, tds_k_value: newK } : tk);
                                                setTanks(updated);
                                            } else alert('Errore salvataggio');
                                        } catch (err) { console.error(err); alert('Errore'); }
                                    }}
                                    className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl font-semibold transition-colors shadow-lg shadow-cyan-900/20"
                                >
                                    Calcola & Salva K
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* --- TEMP CALIBRATION WIZARD --- */}
            {
                isTempCalibrationOpen && (
                    <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
                        <div className="bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl border border-slate-600 flex flex-col max-h-[90vh]">
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center shrink-0">
                                <h3 className="font-bold text-slate-100 flex items-center gap-2">🌡️ Calibrazione Temperatura</h3>
                                <button onClick={() => setIsTempCalibrationOpen(false)}>
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                            </div>
                            <div className="p-6 space-y-6 overflow-y-auto">
                                {/* Step 1: Input Reference */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-cyan-900 text-cyan-400 flex items-center justify-center font-bold">1</div>
                                        <h4 className="text-slate-200 font-semibold">Inserisci Temperatura Riferimento</h4>
                                    </div>
                                    <p className="text-sm text-slate-400 ml-11">
                                        Usa un termometro di precisione per leggere la temperatura attuale dell'acqua.
                                        Inserisci il valore sotto.
                                    </p>
                                    <div className="ml-11">
                                        <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Temperatura Reale (°C)</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-cyan-500"
                                            placeholder="25.0"
                                            defaultValue={25.0}
                                            id="tempTargetInput"
                                        />
                                    </div>
                                </div>

                                {/* Step 2: Live Reading */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-cyan-900 text-cyan-400 flex items-center justify-center font-bold">2</div>
                                        <h4 className="text-slate-200 font-semibold">Lettura Attuale</h4>
                                    </div>
                                    <div className="ml-11 bg-slate-900 p-4 rounded-xl border border-slate-700 flex justify-between items-center">
                                        <div>
                                            <div className="text-xs text-slate-500 uppercase">Sensore</div>
                                            <div className="text-2xl font-bold text-red-400">{sensors.temp} <span className="text-sm text-slate-500">°C</span></div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs text-slate-500 uppercase">Offset Attuale</div>
                                            <div className="text-sm text-slate-300 font-mono">
                                                {tanks.find(t => t.id === selectedTankId)?.temp_offset?.toFixed(2) || '0.00'}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Action */}
                                <button
                                    onClick={async () => {
                                        if (!confirm('Vuoi resettare la calibrazione Temperatura (Offset 0.0)?')) return;
                                        try {
                                            const res = await fetch(`${API_BASE}/tanks/${selectedTankId}`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ temp_offset: 0.0 })
                                            });
                                            if (res.ok) {
                                                alert('Reset completato!');
                                                setIsTempCalibrationOpen(false);
                                                const updated = tanks.map(t => t.id === selectedTankId ? { ...t, temp_offset: 0.0 } : t);
                                                setTanks(updated);
                                            }
                                        } catch (e) { console.error(e); alert('Errore reset'); }
                                    }}
                                    className="w-full py-3 mb-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
                                >
                                    <RotateCcw size={16} /> Reset Default
                                </button>
                                <button
                                    onClick={async () => {
                                        try {
                                            const targetVal = parseFloat(document.getElementById('tempTargetInput').value);
                                            if (isNaN(targetVal)) return alert("Inserisci un valore valido");

                                            // Logic: NewOffset = Target - (CurrentReading - OldOffset)
                                            const t = tanks.find(tank => tank.id === selectedTankId);
                                            const oldOffset = t?.temp_offset || 0.0;
                                            const currentVal = parseFloat(sensors.temp);

                                            // RawReading = currentVal - oldOffset
                                            // NewOffset = targetVal - RawReading = targetVal - currentVal + oldOffset
                                            const newOffset = targetVal - currentVal + oldOffset;

                                            const res = await fetch(`${API_BASE}/tanks/${selectedTankId}`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ temp_offset: newOffset })
                                            });

                                            if (res.ok) {
                                                alert(`Calibrazione completata!\nNuovo Offset: ${newOffset.toFixed(2)}°C (Era: ${oldOffset.toFixed(2)}°C)`);
                                                setIsTempCalibrationOpen(false);
                                                const updated = tanks.map(tk => tk.id === selectedTankId ? { ...tk, temp_offset: newOffset } : tk);
                                                setTanks(updated);
                                            } else alert('Errore salvataggio');
                                        } catch (err) { console.error(err); alert('Errore'); }
                                    }}
                                    className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl font-semibold transition-colors shadow-lg shadow-cyan-900/20"
                                >
                                    Calcola & Salva Offset
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* --- RESTORE MODAL --- */}
            {
                isRestoreModalOpen && restoreFileContent && (
                    <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
                        <div className="bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl border border-slate-600">
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                                <h3 className="font-bold text-slate-100 flex items-center gap-2">📤 Importa Backup</h3>
                                <button onClick={() => { setIsRestoreModalOpen(false); setRestoreFileContent(null); }}>
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                                    <p className="text-xs text-orange-400 font-bold flex items-center gap-2 mb-1">
                                        <AlertTriangle className="w-3 h-3" /> ATTENZIONE
                                    </p>
                                    <p className="text-[10px] text-orange-300">
                                        I dati attuali verranno sovrascritti permanentemente.
                                    </p>
                                </div>

                                <p className="text-sm text-slate-400">Seleziona cosa ripristinare:</p>
                                <div className="space-y-2">
                                    {[
                                        { id: 'config', label: 'Configurazione' },
                                        { id: 'schedules', label: 'Programmazione' },
                                        { id: 'livestock', label: 'Pesci & Vivo' },
                                        { id: 'history', label: 'Storico Dati & Log' }
                                    ].map(opt => (
                                        <label key={opt.id} className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg cursor-pointer hover:bg-slate-900 transition-colors">
                                            <input
                                                type="checkbox"
                                                className="w-5 h-5 rounded border-slate-600 text-cyan-500 focus:ring-cyan-500 bg-slate-800"
                                                checked={restoreSelection[opt.id]}
                                                onChange={e => setRestoreSelection({ ...restoreSelection, [opt.id]: e.target.checked })}
                                            />
                                            <span className="text-sm font-medium text-slate-200">{opt.label}</span>
                                        </label>
                                    ))}
                                </div>
                                <button
                                    onClick={async () => {
                                        try {
                                            const sections = Object.keys(restoreSelection).filter(k => restoreSelection[k]);
                                            if (sections.length === 0) return alert('Seleziona almeno una categoria');

                                            await fetch(`${API_BASE}/restore?tankId=${selectedTankId}`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    data: restoreFileContent,
                                                    sections: sections
                                                })
                                            });
                                            alert('Backup ripristinato con successo!');
                                            window.location.reload();
                                        } catch (err) {
                                            console.error('Restore error:', err);
                                            alert('Errore durante il ripristino');
                                        }
                                    }}
                                    className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-semibold transition-colors flex justify-center items-center gap-2"
                                >
                                    <Upload className="w-4 h-4" /> Ripristina Selezionati
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
            {/* --- ADD/EDIT SCHEDULE MODAL --- */}
            {
                isAddScheduleOpen && (
                    <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
                        <div className="bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl border border-slate-600">
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                                <h3 className="font-bold text-slate-100">
                                    {editingScheduleId ? 'Modifica Programmazione' : 'Nuova Programmazione'}
                                </h3>
                                <button onClick={closeScheduleModal}>
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="text-xs text-slate-400 uppercase font-bold block mb-2">Etichetta</label>
                                    <input
                                        type="text"
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-cyan-500 outline-none"
                                        placeholder="Es. Luci Mattina"
                                        value={newSchedule.label}
                                        onChange={e => setNewSchedule({ ...newSchedule, label: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 uppercase font-bold block mb-2">Dispositivo</label>
                                    <select
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:border-cyan-500 outline-none"
                                        value={newSchedule.deviceId}
                                        onChange={e => setNewSchedule({ ...newSchedule, deviceId: e.target.value })}
                                    >
                                        {deviceOptions.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
                                    </select>
                                </div>

                                {/* Time inputs - different for feeder vs other devices */}
                                {newSchedule.deviceId === 'feeder' ? (
                                    <>
                                        <div>
                                            <label className="text-xs text-slate-400 uppercase font-bold block mb-2">Orario Erogazione</label>
                                            <input
                                                type="time"
                                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200"
                                                value={newSchedule.startTime}
                                                onChange={e => setNewSchedule({ ...newSchedule, startTime: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 uppercase font-bold block mb-2">Quantità</label>
                                            <div className="flex gap-2">
                                                {[1, 2, 3].map(qty => (
                                                    <button
                                                        key={qty}
                                                        onClick={() => setNewSchedule({ ...newSchedule, quantity: qty })}
                                                        className={`flex-1 py-3 rounded-lg font-bold text-lg transition-all ${newSchedule.quantity === qty
                                                            ? 'bg-orange-500 text-white'
                                                            : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                                            }`}
                                                    >
                                                        {qty}x
                                                    </button>
                                                ))}
                                            </div>
                                            <p className="text-[10px] text-slate-500 mt-1 text-center">Numero di erogazioni</p>
                                        </div>
                                    </>
                                ) : (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs text-slate-400 uppercase font-bold block mb-2">Start</label>
                                            <input
                                                type="time"
                                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200"
                                                value={newSchedule.startTime}
                                                onChange={e => setNewSchedule({ ...newSchedule, startTime: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 uppercase font-bold block mb-2">End</label>
                                            <input
                                                type="time"
                                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200"
                                                value={newSchedule.endTime}
                                                onChange={e => setNewSchedule({ ...newSchedule, endTime: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="text-xs text-slate-400 uppercase font-bold block mb-2">Giorni Attivi</label>
                                    <div className="flex justify-between gap-1">
                                        {dayNames.map((day, idx) => {
                                            const isSelected = newSchedule.days.includes(idx);
                                            return (
                                                <button
                                                    key={day}
                                                    onClick={() => toggleDay(idx)}
                                                    className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${isSelected ? 'bg-cyan-500 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                                                >
                                                    {day[0]}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        console.log('Save clicked', newSchedule, editingScheduleId);
                                        saveSchedule();
                                    }}
                                    disabled={!newSchedule.label || newSchedule.days.length === 0}
                                    className="w-full py-3 mt-4 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-colors flex justify-center items-center gap-2"
                                >
                                    {editingScheduleId ? (
                                        <><Check className="w-4 h-4" /> Salva Modifiche</>
                                    ) : (
                                        <><Plus className="w-4 h-4" /> Aggiungi Timer</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* --- NAVBAR --- */}
            <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md shrink-0 z-50 h-14">
                <div className="h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-cyan-500/10 rounded-lg">
                            <Fish className="w-5 h-5 text-cyan-400" />
                        </div>
                        <span className="font-bold text-lg tracking-tight">
                            Aqua<span className="text-cyan-400">Mind</span>
                        </span>
                    </div>

                    <div className="hidden md:flex items-center gap-6">
                        {[
                            { id: 'dashboard', label: 'Dashboard' },
                            { id: 'programmazione', label: 'Programmazione' },
                            { id: 'illuminazione', label: 'Illuminazione' },
                            { id: 'manutenzione', label: 'Manutenzione' },
                            { id: 'parametri', label: 'Parametri' },
                            { id: 'pesci', label: 'Pesci' },
                            { id: 'piante', label: 'Piante' },
                            { id: 'alert', label: 'Alert' },
                            { id: 'storico', label: 'Storico' },
                            { id: 'ricette', label: 'Ricette' },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`${activeTab === tab.id ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'} h-14 px-2 transition-all font-medium text-sm capitalize`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Tank Selector */}
                        <div className="relative hidden md:block">
                            <select
                                value={selectedTankId}
                                onChange={(e) => setSelectedTankId(parseInt(e.target.value))}
                                className="bg-slate-800 text-slate-200 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-700 outline-none focus:border-cyan-500 appearance-none pr-8 cursor-pointer"
                            >
                                {tanks.length > 0 ? tanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>) : <option value={1}>Main Aquarium</option>}
                            </select>
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                            </div>
                        </div>

                        {/* Settings Dropdown */}
                        <div className="relative">
                            <button
                                onClick={() => setShowSettingsMenu(prev => !prev)}
                                className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
                                title="Impostazioni"
                            >
                                <Settings className="w-5 h-5" />
                            </button>
                            {showSettingsMenu && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowSettingsMenu(false)}></div>
                                    <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 p-3 space-y-2">
                                        <h3 className="text-sm font-medium text-slate-200 mb-3">Gestione</h3>
                                        <button
                                            onClick={() => {
                                                setEditingTank(null);
                                                setNewTankDims({ width: '', height: '', depth: '', volume: '' });
                                                setIsAddTankModalOpen(true);
                                                setShowSettingsMenu(false);
                                            }}
                                            className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg flex items-center justify-center gap-2 mb-2"
                                        >
                                            ➕ Aggiungi Acquario
                                        </button>
                                        <button
                                            onClick={() => { setIsManageTanksModalOpen(true); setShowSettingsMenu(false); }}
                                            className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg flex items-center justify-center gap-2"
                                        >
                                            ⚙️ Gestione Vasche
                                        </button>
                                        <div className="h-px bg-slate-700 my-2"></div>
                                        <h3 className="text-sm font-medium text-slate-200 mb-3">Backup & Ripristino</h3>
                                        <button
                                            onClick={() => { handleExportTank(); setShowSettingsMenu(false); }}
                                            className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg flex items-center justify-center gap-2"
                                        >
                                            📥 Esporta Backup
                                        </button>
                                        <label className="w-full px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-lg cursor-pointer flex items-center justify-center gap-2">
                                            📤 Importa Backup
                                            <input type="file" accept=".json" className="hidden" onChange={async (e) => {
                                                const file = e.target.files[0];
                                                if (!file) return;
                                                try {
                                                    const data = JSON.parse(await file.text());
                                                    await handleImportTank(data);
                                                } catch (err) {
                                                    alert('File backup non valido o corrotto');
                                                }
                                                setShowSettingsMenu(false);
                                                e.target.value = '';
                                            }} />
                                        </label>

                                        {/* Camera Image Controls Removed from Here */}
                                    </div>
                                </>
                            )}
                        </div>
                        <span className="text-xs text-slate-400 font-mono hidden sm:block">
                            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full border ${isConnected
                            ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                            : 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                            }`}>
                            {isConnected ? (
                                <>
                                    <Wifi className="w-3 h-3" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    ONLINE
                                </>
                            ) : (
                                <>
                                    <WifiOff className="w-3 h-3" />
                                    OFFLINE
                                </>
                            )}
                        </span>
                        <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="md:hidden p-2 text-slate-400 hover:bg-slate-800 rounded-lg">
                            <Menu className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </nav>

            {/* --- MOBILE MENU --- */}
            {
                isMenuOpen && (
                    <div className="md:hidden absolute top-14 left-0 right-0 bg-slate-800 border-b border-slate-700 z-40 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
                        {[
                            'dashboard',
                            'programmazione',
                            'illuminazione',
                            'manutenzione',
                            'parametri',
                            'pesci',
                            'piante',
                            'alert',
                            'storico',
                            'ricette'
                        ].map(tab => (
                            <button
                                key={tab}
                                onClick={() => { setActiveTab(tab); setIsMenuOpen(false); }}
                                className={`w-full px-4 py-3 text-left border-l-4 transition-all ${activeTab === tab
                                    ? 'border-cyan-400 text-cyan-400 bg-slate-700/50'
                                    : 'border-transparent text-slate-300 hover:bg-slate-700/30'}`}
                            >
                                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            </button>
                        ))}
                    </div>
                )
            }

            {/* --- MAIN CONTENT --- */}
            <main className="flex-1 p-4 overflow-hidden">

                {/* VIEW: DASHBOARD */}
                {activeTab === 'dashboard' && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full overflow-y-auto lg:overflow-hidden pb-20 lg:pb-0 custom-scrollbar">
                        <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-4 h-auto lg:h-full lg:overflow-hidden">
                            {/* Video Feed */}
                            <div
                                ref={videoContainerRef}
                                className={`flex-1 bg-slate-800 rounded-2xl overflow-hidden shadow-xl border border-slate-700/50 relative group min-h-[300px] lg:min-h-0 flex flex-col ${isFullscreen ? 'rounded-none min-h-screen fixed inset-0 z-50' : ''}`}
                            >
                                <div className="absolute top-0 left-0 right-0 p-4 z-10 flex justify-between items-start bg-gradient-to-b from-black/60 to-transparent">
                                    <div className="flex gap-2">
                                        <span className="bg-red-500/90 text-white text-[10px] font-bold px-2 py-1 rounded animate-pulse flex items-center gap-1">
                                            <div className="w-1.5 h-1.5 bg-white rounded-full"></div> LIVE
                                        </span>
                                        <span className="bg-black/40 backdrop-blur text-slate-200 text-[10px] font-medium px-2 py-1 rounded border border-white/10">
                                            Main Tank • {cameraSettings.resolution} • {cameraSettings.fps}fps
                                        </span>
                                    </div>
                                    <div className="flex gap-2">
                                        {/* Camera Refresh Button */}
                                        <button
                                            onClick={handleRestartCamera}
                                            disabled={cameraRebooting}
                                            className={`p-1.5 bg-black/40 hover:bg-white/10 rounded-lg text-white/80 transition-colors backdrop-blur ${cameraRebooting ? 'text-cyan-500 animate-pulse' : ''}`}
                                            title="Riavvia Camera"
                                        >
                                            <RefreshCw size={16} className={cameraRebooting ? 'animate-spin' : ''} />
                                        </button>
                                        {/* Camera Settings Button */}
                                        <div className="relative">
                                            {(() => {
                                                const currentTank = tanks.find(t => t.id === selectedTankId);
                                                // Check if it's an RTSP stream but NOT ID > 1 (ESP32 usually ID > 1 and we want settings for them now)
                                                // Actually, simplify: Show settings for all, but customize content inside
                                                if (!currentTank) return null; // Safety check

                                                return (
                                                    <>
                                                        <button
                                                            onClick={() => setIsCameraSettingsOpen(!isCameraSettingsOpen)}
                                                            className="p-1.5 bg-black/40 hover:bg-white/10 rounded-lg text-white/80 transition-colors backdrop-blur"
                                                            title="Impostazioni Camera"
                                                        >
                                                            <Settings size={16} />
                                                        </button>
                                                        {isCameraSettingsOpen && (
                                                            <div className="absolute right-0 top-10 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-3 min-w-[240px] z-20">
                                                                <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Impostazioni Camera</h4>

                                                                {/* Res & FPS - Single Row */}
                                                                {selectedTankId === 1 && (
                                                                    <div className="grid grid-cols-2 gap-2 mb-2">
                                                                        <div>
                                                                            <label className="text-[9px] text-slate-500 block mb-0.5 uppercase">Res</label>
                                                                            <select
                                                                                value={cameraSettings.resolution}
                                                                                onChange={(e) => updateCameraSettings({ resolution: e.target.value })}
                                                                                className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-1 text-[10px] text-slate-200"
                                                                            >
                                                                                {cameraSettings.available?.resolutions?.map(res => (
                                                                                    <option key={res} value={res}>{res}</option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-[9px] text-slate-500 block mb-0.5 uppercase">FPS</label>
                                                                            <select
                                                                                value={cameraSettings.fps}
                                                                                onChange={(e) => updateCameraSettings({ fps: parseInt(e.target.value) })}
                                                                                className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-1 text-[10px] text-slate-200"
                                                                            >
                                                                                {cameraSettings.available?.fps?.map(f => (
                                                                                    <option key={f} value={f}>{f}</option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* Image Controls */}
                                                                <div className="pt-2 border-t border-slate-700">
                                                                    {(() => {
                                                                        const currentTank = tanks.find(t => t.id === selectedTankId);
                                                                        if (!currentTank) return null;

                                                                        const updateCamSetting = (key, val) => {
                                                                            const updatedTanks = tanks.map(t =>
                                                                                t.id === selectedTankId ? { ...t, [key]: val } : t
                                                                            );
                                                                            setTanks(updatedTanks);

                                                                            if (window.camDebounce) clearTimeout(window.camDebounce);
                                                                            window.camDebounce = setTimeout(() => {
                                                                                const t = updatedTanks.find(tk => tk.id === selectedTankId);
                                                                                fetch(`${API_BASE}/tanks/${selectedTankId}/camera-settings`, {
                                                                                    method: 'POST',
                                                                                    headers: { 'Content-Type': 'application/json' },
                                                                                    body: JSON.stringify({
                                                                                        cam_brightness: t.cam_brightness ?? 0.0,
                                                                                        cam_contrast: t.cam_contrast ?? 1.0,
                                                                                        cam_saturation: t.cam_saturation ?? 1.0
                                                                                    })
                                                                                })
                                                                                    .then(res => res.json())
                                                                                    .then(data => {
                                                                                        if (data.success) {
                                                                                            setTimeout(() => {
                                                                                                setCameraTimestamp(Date.now());
                                                                                            }, 1000);
                                                                                        }
                                                                                    })
                                                                                    .catch(err => console.error(err));
                                                                            }, 500);
                                                                        };

                                                                        return (
                                                                            <div className="space-y-2">
                                                                                {[
                                                                                    { label: 'Lum', key: 'cam_brightness', min: -1.0, max: 1.0, step: 0.1, def: 0.0 },
                                                                                    { label: 'Con', key: 'cam_contrast', min: 0.0, max: 2.0, step: 0.1, def: 1.0 },
                                                                                    { label: 'Sat', key: 'cam_saturation', min: 0.0, max: 3.0, step: 0.1, def: 1.0 }
                                                                                ].map(ctrl => (
                                                                                    <div key={ctrl.key} className="flex items-center gap-2">
                                                                                        <span className="w-6 text-[9px] text-slate-500 uppercase font-bold shrink-0">{ctrl.label}</span>
                                                                                        <input
                                                                                            type="range"
                                                                                            min={ctrl.min} max={ctrl.max} step={ctrl.step}
                                                                                            value={currentTank[ctrl.key] ?? ctrl.def}
                                                                                            onChange={(e) => updateCamSetting(ctrl.key, parseFloat(e.target.value))}
                                                                                            className="flex-1 accent-cyan-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                                                                        />
                                                                                        <span className="w-6 text-[9px] text-cyan-400 font-bold text-right shrink-0">
                                                                                            {currentTank[ctrl.key] ?? ctrl.def}
                                                                                        </span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        );
                                                                    })()}
                                                                </div>

                                                                <div className="pt-2 mt-2 border-t border-slate-700">
                                                                    <button
                                                                        onClick={() => setIsCameraSettingsOpen(false)}
                                                                        className="w-full py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-[10px] font-bold uppercase tracking-wider"
                                                                    >
                                                                        Chiudi
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                        </div>{/* Fullscreen Button */}
                                        <button
                                            onClick={toggleFullscreen}
                                            className="p-1.5 bg-black/40 hover:bg-white/10 rounded-lg text-white/80 transition-colors backdrop-blur"
                                            title={isFullscreen ? 'Esci da Fullscreen' : 'Fullscreen'}
                                        >
                                            <Maximize2 size={16} />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1 relative bg-gradient-to-br from-slate-900 via-cyan-900/10 to-slate-900 flex items-center justify-center overflow-hidden">
                                    <img
                                        ref={streamImgRef}
                                        src={`${API_BASE}/stream?tankId=${selectedTankId}&t=${cameraTimestamp}`}
                                        alt="Aquarium Live Feed"
                                        className={`w-full h-full ${isFullscreen ? 'object-contain' : 'object-cover'} ${isVideoLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
                                        onLoad={() => setIsVideoLoading(false)}
                                        onError={(e) => {
                                            setIsVideoLoading(false);
                                            e.target.style.display = 'none';
                                            e.target.nextSibling.style.display = 'flex';
                                        }}
                                        crossOrigin="anonymous"
                                    />
                                    {isVideoLoading && (
                                        <div className="absolute inset-0 bg-black flex items-center justify-center z-10">
                                            <div className="text-center">
                                                <Loader className="w-8 h-8 text-cyan-500 animate-spin mx-auto mb-2" />
                                                <p className="text-slate-500 text-xs tracking-widest uppercase">Caricamento Flusso...</p>
                                            </div>
                                        </div>
                                    )}
                                    <div className="absolute inset-0 flex items-center justify-center" style={{ display: 'none' }}>
                                        <div className="text-center z-0">
                                            <Video className="w-10 h-10 text-slate-700 mx-auto mb-2" />
                                            <p className="text-slate-600 text-xs tracking-widest uppercase">Camera Offline</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Sensor Cards */}
                            <div className="h-auto shrink-0 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
                                {[
                                    {
                                        label: 'Temp', val: sensors.temp, unit: '°C', icon: Thermometer, color: getStatusColor(sensors.temp, 'temp'), iconColor: 'text-rose-400',
                                        action: () => {
                                            const t = tanks.find(tank => tank.id === selectedTankId);
                                            setTempConfig({ offset: t?.temp_offset || 0.0 });
                                            setIsTempCalibrationOpen(true);
                                        }
                                    },
                                    {
                                        label: 'pH', val: sensors.ph, unit: '', icon: Droplets, color: getStatusColor(sensors.ph, 'ph'), iconColor: 'text-cyan-400',
                                        action: () => {
                                            const t = tanks.find(tank => tank.id === selectedTankId);
                                            setPhConfig({ offset: t?.ph_offset || 0.0 });
                                            setIsPhCalibrationOpen(true);
                                        }
                                    },
                                    {
                                        label: 'TDS', val: sensors.tds, unit: 'ppm', icon: Waves, color: getStatusColor(sensors.tds, 'tds'), iconColor: 'text-amber-400',
                                        action: () => {
                                            const t = tanks.find(tank => tank.id === selectedTankId);
                                            setTdsConfig({ kValue: t?.tds_k_value || 1.0 });
                                            setIsTdsCalibrationOpen(true);
                                        }
                                    },
                                    {
                                        label: 'Livello', val: sensors.level, unit: '%', icon: Activity, color: 'text-slate-200', iconColor: 'text-emerald-400',
                                        action: () => {
                                            const t = tanks.find(tank => tank.id === selectedTankId);
                                            setLevelConfig({
                                                minDistance: t?.min_distance || 5.0,
                                                maxDistance: t?.max_distance || 15.0
                                            });
                                            setIsLevelCalibrationOpen(true);
                                        }
                                    },
                                ].map((stat, idx) => (
                                    <div key={idx} className="bg-slate-800 rounded-xl border border-slate-700/50 p-3 flex flex-col justify-between relative overflow-hidden group">
                                        <div className="flex justify-between items-start z-10">
                                            <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                                                {stat.label}
                                                {stat.action && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); stat.action(); }}
                                                        className="text-slate-500 hover:text-cyan-400 transition-all"
                                                        title="Calibra"
                                                    >
                                                        <Settings size={12} />
                                                    </button>
                                                )}
                                            </span>
                                            <stat.icon className={`w-4 h-4 ${stat.iconColor}`} />
                                        </div>
                                        <div className="z-10 flex items-baseline gap-1">
                                            {stat.val === null ? (
                                                <span className="text-slate-500 text-lg animate-pulse">--</span>
                                            ) : (
                                                <>
                                                    <span className={`text-2xl font-bold ${stat.color}`}>{stat.val}</span>
                                                    <span className="text-xs text-slate-500 font-medium">{stat.unit}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Chart */}
                            <div className="shrink-0 bg-slate-800 p-4 rounded-xl border border-slate-700/50 flex flex-col">
                                <div className="flex justify-between items-center mb-2 shrink-0">
                                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                        <Activity size={14} /> Andamento Temperatura
                                    </h3>
                                    <div className="flex gap-1 overflow-x-auto pb-1 custom-scrollbar">
                                        {historyRangeOptions.map(opt => (
                                            <button
                                                key={opt.hours}
                                                onClick={() => setHistoryRange(opt.hours)}
                                                className={`px-2 py-0.5 text-[10px] rounded font-medium whitespace-nowrap transition-colors ${historyRange === opt.hours
                                                    ? 'bg-cyan-500 text-white'
                                                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                                    }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                        <button
                                            onClick={() => { setIsHistoryModalOpen(true); fetchHistoryLog(); }}
                                            className="px-2 py-0.5 text-[10px] rounded font-medium whitespace-nowrap bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-cyan-400"
                                        >
                                            <List size={10} className="inline mr-1" />Gestisci
                                        </button>
                                    </div>
                                </div>
                                <div className={`${getChartHeight()} w-full transition-all duration-300`}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={historyData}>
                                            <defs>
                                                <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                            <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                                            <YAxis stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} domain={['dataMin - 0.5', 'dataMax + 0.5']} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '6px', fontSize: '12px' }}
                                                itemStyle={{ color: '#22d3ee' }}
                                            />
                                            <Line type="monotone" dataKey="temp" stroke="#22d3ee" strokeWidth={2} dot={false} fill="url(#colorTemp)" />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Controls */}
                        <div className="lg:col-span-4 xl:col-span-3 flex flex-col h-auto lg:h-full bg-slate-800 rounded-2xl border border-slate-700/50 overflow-visible lg:overflow-hidden">
                            <div className="p-4 bg-gradient-to-r from-cyan-950 to-slate-800 border-b border-cyan-500/20 shrink-0">
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="font-bold text-cyan-400 flex items-center gap-2 text-sm">
                                        <Sparkles className="w-4 h-4" /> AquaMind Agent
                                    </h3>
                                    <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500/30">AGENTIC</span>
                                </div>
                                <button
                                    onClick={() => { setAiMode('analysis'); setIsAiModalOpen(true); }}
                                    className="w-full py-2 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/50 hover:border-cyan-400 text-cyan-300 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 group"
                                >
                                    <Activity className="w-3 h-3 group-hover:animate-pulse" /> Diagnostica Rapida
                                </button>
                            </div>
                            <div className="px-4 py-3 border-b border-slate-700/50 bg-slate-800 shrink-0">
                                <h3 className="font-semibold text-slate-200 flex items-center gap-2 text-sm">
                                    <Settings className="w-4 h-4 text-slate-400" /> Controlli Manuali
                                </h3>
                            </div>
                            <div className="h-auto lg:flex-1 lg:overflow-y-auto p-4 space-y-5 custom-scrollbar">
                                {/* Lights */}
                                <div className="space-y-3">
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Illuminazione</p>
                                    <div className="group flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-cyan-500/30 transition-all">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-md transition-colors ${controls.mainLight ? 'bg-yellow-500/20 text-yellow-400' : 'bg-slate-800 text-slate-600'}`}>
                                                <Sun size={18} />
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm text-slate-300">Luci Diurne</p>
                                                <p className="text-[10px] text-slate-500">{controls.mainLight ? 'ON' : 'OFF'}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => toggleControl('mainLight')}
                                            className={`w-10 h-5 rounded-full transition-colors relative ${controls.mainLight ? 'bg-cyan-500' : 'bg-slate-700'}`}
                                        >
                                            <span className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-transform ${controls.mainLight ? 'left-6' : 'left-1'}`} />
                                        </button>
                                    </div>
                                    <div className="group flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-cyan-500/30 transition-all">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-md transition-colors ${controls.blueLight ? 'bg-blue-600/20 text-blue-400' : 'bg-slate-800 text-slate-600'}`}>
                                                <Lightbulb size={18} />
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm text-slate-300">Luci Lunari</p>
                                                <p className="text-[10px] text-slate-500">{controls.blueLight ? 'ON' : 'OFF'}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => toggleControl('blueLight')}
                                            className={`w-10 h-5 rounded-full transition-colors relative ${controls.blueLight ? 'bg-cyan-500' : 'bg-slate-700'}`}
                                        >
                                            <span className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-transform ${controls.blueLight ? 'left-6' : 'left-1'}`} />
                                        </button>
                                    </div>
                                </div>
                                {/* Pumps */}
                                <div className="h-px bg-slate-700/50" />
                                <div className="space-y-3">
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pompe & Filtri</p>
                                    <div className="group flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-cyan-500/30 transition-all">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-md transition-colors ${controls.pump ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
                                                <Wind size={18} />
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm text-slate-300">Pompa Risalita</p>
                                                <p className="text-[10px] text-slate-500">{controls.pump ? 'Attiva' : 'Spenta'}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => toggleControl('pump')}
                                            className={`w-10 h-5 rounded-full transition-colors relative ${controls.pump ? 'bg-cyan-500' : 'bg-slate-700'}`}
                                        >
                                            <span className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-transform ${controls.pump ? 'left-6' : 'left-1'}`} />
                                        </button>
                                    </div>
                                    {/* Skimmer Control */}
                                    <div className="group flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-cyan-500/30 transition-all">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-md transition-colors ${controls.skimmer ? 'bg-purple-500/20 text-purple-400' : 'bg-slate-800 text-slate-600'}`}>
                                                <Waves size={18} />
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm text-slate-300">Skimmer</p>
                                                <p className="text-[10px] text-slate-500">{controls.skimmer ? 'Attivo' : 'Spento'}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => toggleControl('skimmer')}
                                            className={`w-10 h-5 rounded-full transition-colors relative ${controls.skimmer ? 'bg-cyan-500' : 'bg-slate-700'}`}
                                        >
                                            <span className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-transform ${controls.skimmer ? 'left-6' : 'left-1'}`} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            {/* Footer Actions */}
                            <div className="p-4 bg-slate-800 border-t border-slate-700/50 shrink-0 space-y-3">
                                <button
                                    className={`w-full py-3 rounded-xl border flex items-center justify-center gap-2 transition-all active:scale-95 text-sm ${controls.feeder
                                        ? 'bg-orange-500/20 border-orange-500 text-orange-400'
                                        : 'bg-slate-900 hover:bg-slate-700 border-slate-700 text-slate-300'
                                        }`}
                                    onClick={() => {
                                        toggleControl('feeder');
                                        setTimeout(() => toggleControl('feeder'), 2000);
                                    }}
                                >
                                    <Fish size={16} className={controls.feeder ? 'animate-bounce' : ''} />
                                    <span className="font-semibold">{controls.feeder ? 'Erogazione...' : 'Cibo Ora'}</span>
                                </button>
                                {upcomingEvents.length > 0 && (
                                    <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/20 space-y-2">
                                        <div className="flex items-center gap-2 mb-1">
                                            <AlertTriangle className="w-4 h-4 text-red-400" />
                                            <h4 className="text-red-400 font-bold text-xs">Manutenzione Richiesta</h4>
                                        </div>
                                        <div className="space-y-2">
                                            {upcomingEvents.map((event, idx) => (
                                                <div key={idx} className={`flex justify-between items-center ${event.days <= 1 ? 'animate-pulse' : ''}`}>
                                                    <div className="flex items-center gap-1 min-w-0">
                                                        {event.isRecurring && <span className="text-[10px] text-slate-500">↻</span>}
                                                        <span className="text-slate-300 text-[10px] font-medium truncate">{event.label}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-slate-600 text-[9px] font-mono">{event.formattedDate}</span>
                                                        <span className={`text-[10px] whitespace-nowrap ${event.days <= 1 ? 'text-orange-400 font-bold' : 'text-slate-500'}`}>
                                                            {event.days === 0 ? 'Oggi' : event.days === 1 ? 'Domani' : `-${event.days}gg`}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* VIEW: SCHEDULING */}
                {activeTab === 'programmazione' && (
                    <div className="max-w-4xl mx-auto h-full flex flex-col">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-100">Pianificazione Automatica</h2>
                                <p className="text-slate-400 text-sm">Gestisci cicli luce e attività pompe</p>
                            </div>
                            <button
                                onClick={() => setIsAddScheduleOpen(true)}
                                className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
                            >
                                <Plus size={18} /> Nuovo Timer
                            </button>
                        </div>

                        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4 overflow-y-auto pb-20 custom-scrollbar">
                            {schedules.map(schedule => (
                                <div key={schedule.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col gap-4 relative group hover:border-cyan-500/50 transition-colors">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-slate-700/50 rounded-lg text-cyan-400">
                                                {schedule.deviceId.includes('Light') ? <Sun size={20} /> : <Wind size={20} />}
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-200">{schedule.label}</h3>
                                                <p className="text-xs text-slate-500 uppercase">
                                                    {deviceOptions.find(d => d.id === schedule.deviceId)?.name}
                                                </p>
                                            </div>
                                        </div>
                                        <div className={`w-2 h-2 rounded-full ${schedule.active ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-600'}`}></div>
                                    </div>

                                    <div className="bg-slate-900/50 rounded-lg p-3 flex justify-between items-center">
                                        <div className="text-center">
                                            <p className="text-[10px] text-slate-500 font-bold uppercase">Start</p>
                                            <p className="text-xl font-mono text-slate-200">{schedule.startTime}</p>
                                        </div>
                                        <div className="h-px w-8 bg-slate-700"></div>
                                        <div className="text-center">
                                            <p className="text-[10px] text-slate-500 font-bold uppercase">End</p>
                                            <p className="text-xl font-mono text-slate-200">{schedule.endTime}</p>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-[10px] text-slate-500 font-bold uppercase mb-2">Giorni Attivi</p>
                                        <div className="flex justify-between">
                                            {dayNames.map((d, i) => (
                                                <span key={i} className={`text-[10px] w-5 h-5 flex items-center justify-center rounded ${schedule.days.includes(i) ? 'bg-cyan-500/20 text-cyan-400 font-bold' : 'text-slate-600'}`}>
                                                    {d[0]}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex gap-2 mt-2">
                                        <button
                                            onClick={() => toggleScheduleActive(schedule.id, schedule.active)}
                                            className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${schedule.active ? 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10' : 'border-slate-600 text-slate-400 hover:bg-slate-700'}`}
                                        >
                                            {schedule.active ? 'ATTIVO' : 'IN PAUSA'}
                                        </button>
                                        <button
                                            onClick={() => startEditSchedule(schedule)}
                                            className="p-2 rounded-lg border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                                            title="Modifica"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button
                                            onClick={() => deleteSchedule(schedule.id)}
                                            className="p-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                                            title="Elimina"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}

                            {schedules.length === 0 && (
                                <div className="col-span-full py-12 flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-700 rounded-xl">
                                    <Calendar size={48} className="mb-4 opacity-50" />
                                    <p>Nessuna programmazione attiva.</p>
                                    <button onClick={() => setIsAddScheduleOpen(true)} className="mt-2 text-cyan-400 hover:underline">
                                        Crea il primo timer
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* VIEW: ILLUMINAZIONE (Chihiros LED) */}
                {activeTab === 'illuminazione' && (
                    <div className="max-w-4xl mx-auto p-6 space-y-6 overflow-y-auto h-full">
                        <div className="flex justify-between items-center">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-100">💡 Illuminazione Chihiros</h2>
                                <p className="text-slate-400 text-sm">Gestisci le lampade LED Chihiros via Bluetooth</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={scanChihirosDevices}
                                    disabled={isScanning}
                                    className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 ${isScanning
                                        ? 'bg-slate-700 text-slate-400 cursor-wait'
                                        : 'bg-cyan-600 hover:bg-cyan-700 text-white'
                                        }`}
                                >
                                    {isScanning ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Scansione...
                                        </>
                                    ) : (
                                        <>
                                            <Search size={16} />
                                            Cerca Lampade
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Scan Results */}
                        {chihirosScanResults.length > 0 && (
                            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4">
                                <h3 className="text-sm font-bold text-cyan-400 uppercase mb-3">Lampade Trovate</h3>
                                <div className="space-y-2">
                                    {chihirosScanResults.map(device => (
                                        <div key={device.address} className="flex items-center justify-between bg-slate-800 rounded-lg p-3">
                                            <div>
                                                <div className="font-medium text-slate-200">{device.name}</div>
                                                <div className="text-xs text-slate-500">{device.address} • {device.model}</div>
                                            </div>
                                            <button
                                                onClick={() => addChihirosDevice(device)}
                                                className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg"
                                            >
                                                + Aggiungi
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Saved Devices */}
                        {chihirosDevices.length === 0 ? (
                            <div className="bg-slate-800 rounded-2xl border border-slate-700/50 p-8 text-center">
                                <Lightbulb size={48} className="mx-auto text-slate-600 mb-4" />
                                <p className="text-slate-400">Nessuna lampada configurata</p>
                                <p className="text-slate-500 text-sm mt-1">Clicca "Cerca Lampade" per trovare dispositivi Chihiros via Bluetooth</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
                                {chihirosDevices.map(device => (
                                    <div key={device.id} className="bg-slate-800 rounded-2xl border border-slate-700/50 p-5">
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${device.is_on ? 'bg-yellow-500/20 text-yellow-400' : 'bg-slate-700 text-slate-500'
                                                    }`}>
                                                    <Lightbulb size={24} />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-slate-200">{device.name}</h3>
                                                    <p className="text-xs text-slate-500">{device.model} • {device.address}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => controlChihiros(device.id, device.is_on ? 'off' : 'on')}
                                                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${device.is_on
                                                        ? 'bg-green-600 text-white'
                                                        : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                                        }`}
                                                >
                                                    {device.is_on ? 'ON' : 'OFF'}
                                                </button>
                                                <button
                                                    onClick={() => removeChihirosDevice(device.id)}
                                                    className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Brightness Slider */}
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-400">Luminosità</span>
                                                <span className="text-slate-300 font-mono">
                                                    {pendingBrightness[device.id] !== undefined
                                                        ? pendingBrightness[device.id]
                                                        : device.brightness || 0}%
                                                </span>
                                            </div>
                                            <input
                                                type="range"
                                                min="0"
                                                max="100"
                                                value={pendingBrightness[device.id] !== undefined
                                                    ? pendingBrightness[device.id]
                                                    : (device.brightness || 0)}
                                                onChange={(e) => setPendingBrightness(prev => ({ ...prev, [device.id]: parseInt(e.target.value) }))}
                                                onPointerUp={(e) => {
                                                    const val = parseInt(e.target.value);
                                                    controlChihiros(device.id, 'brightness', { brightness: val });
                                                    setPendingBrightness(prev => { const n = { ...prev }; delete n[device.id]; return n; });
                                                }}
                                                onTouchEnd={(e) => {
                                                    const val = pendingBrightness[device.id];
                                                    if (val !== undefined) {
                                                        controlChihiros(device.id, 'brightness', { brightness: val });
                                                        setPendingBrightness(prev => { const n = { ...prev }; delete n[device.id]; return n; });
                                                    }
                                                }}
                                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                                            />
                                        </div>

                                        {/* RGB Controls for WRGB models */}
                                        {device.is_rgb === 1 && (
                                            <div className="mt-4 pt-4 border-t border-slate-700">
                                                <div className="text-sm text-slate-400 mb-3">Colori RGB</div>
                                                <div className="space-y-3">
                                                    {/* Red Channel */}
                                                    <div>
                                                        <div className="flex justify-between text-xs mb-1">
                                                            <span className="text-red-400">Rosso</span>
                                                            <span className="text-red-300">
                                                                {pendingRGB[`${device.id}_0`] !== undefined ? pendingRGB[`${device.id}_0`] : (device.red || 0)}%
                                                            </span>
                                                        </div>
                                                        <input
                                                            type="range"
                                                            min="0"
                                                            max="100"
                                                            value={pendingRGB[`${device.id}_0`] !== undefined ? pendingRGB[`${device.id}_0`] : (device.red || 0)}
                                                            onChange={(e) => setPendingRGB(prev => ({ ...prev, [`${device.id}_0`]: parseInt(e.target.value) }))}
                                                            onPointerUp={(e) => {
                                                                controlChihiros(device.id, 'channel', { channel: 0, brightness: parseInt(e.target.value) });
                                                                setPendingRGB(prev => { const n = { ...prev }; delete n[`${device.id}_0`]; return n; });
                                                            }}
                                                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-red-500"
                                                        />
                                                    </div>
                                                    {/* Green Channel */}
                                                    <div>
                                                        <div className="flex justify-between text-xs mb-1">
                                                            <span className="text-green-400">Verde</span>
                                                            <span className="text-green-300">
                                                                {pendingRGB[`${device.id}_1`] !== undefined ? pendingRGB[`${device.id}_1`] : (device.green || 0)}%
                                                            </span>
                                                        </div>
                                                        <input
                                                            type="range"
                                                            min="0"
                                                            max="100"
                                                            value={pendingRGB[`${device.id}_1`] !== undefined ? pendingRGB[`${device.id}_1`] : (device.green || 0)}
                                                            onChange={(e) => setPendingRGB(prev => ({ ...prev, [`${device.id}_1`]: parseInt(e.target.value) }))}
                                                            onPointerUp={(e) => {
                                                                controlChihiros(device.id, 'channel', { channel: 1, brightness: parseInt(e.target.value) });
                                                                setPendingRGB(prev => { const n = { ...prev }; delete n[`${device.id}_1`]; return n; });
                                                            }}
                                                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                                                        />
                                                    </div>
                                                    {/* Blue Channel */}
                                                    <div>
                                                        <div className="flex justify-between text-xs mb-1">
                                                            <span className="text-blue-400">Blu</span>
                                                            <span className="text-blue-300">
                                                                {pendingRGB[`${device.id}_2`] !== undefined ? pendingRGB[`${device.id}_2`] : (device.blue || 0)}%
                                                            </span>
                                                        </div>
                                                        <input
                                                            type="range"
                                                            min="0"
                                                            max="100"
                                                            value={pendingRGB[`${device.id}_2`] !== undefined ? pendingRGB[`${device.id}_2`] : (device.blue || 0)}
                                                            onChange={(e) => setPendingRGB(prev => ({ ...prev, [`${device.id}_2`]: parseInt(e.target.value) }))}
                                                            onPointerUp={(e) => {
                                                                controlChihiros(device.id, 'channel', { channel: 2, brightness: parseInt(e.target.value) });
                                                                setPendingRGB(prev => { const n = { ...prev }; delete n[`${device.id}_2`]; return n; });
                                                            }}
                                                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Server-Side Auto Schedule */}
                                        <div className="mt-4 pt-4 border-t border-slate-700">
                                            {/* Auto Schedule - Server-Side */}
                                            <div className="bg-slate-900/50 rounded-lg p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="text-xs text-slate-400">Programmazione Automatica</div>
                                                    <button
                                                        onClick={async () => {
                                                            const newState = !device.auto_mode;
                                                            const onTime = document.getElementById(`on-time-${device.id}`)?.value || '08:00';
                                                            const offTime = document.getElementById(`off-time-${device.id}`)?.value || '18:00';
                                                            await fetch(`/api/chihiros/devices/${device.id}/auto-schedule`, {
                                                                method: 'POST',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ auto_mode: newState, on_time: onTime, off_time: offTime })
                                                            });
                                                            fetchChihirosDevices();
                                                        }}
                                                        className={`px-3 py-1 text-xs rounded-lg font-medium ${device.auto_mode
                                                            ? 'bg-green-600 text-white'
                                                            : 'bg-slate-700 text-slate-400'
                                                            }`}
                                                    >
                                                        {device.auto_mode ? 'AUTO ON' : 'AUTO OFF'}
                                                    </button>
                                                </div>
                                                <div className="flex flex-wrap gap-2 items-center">
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-slate-500 text-xs">Accendi:</span>
                                                        <input
                                                            type="time"
                                                            defaultValue={device.on_time || "08:00"}
                                                            id={`on-time-${device.id}`}
                                                            onChange={async (e) => {
                                                                const offTime = document.getElementById(`off-time-${device.id}`)?.value || '18:00';
                                                                await fetch(`/api/chihiros/devices/${device.id}/auto-schedule`, {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ auto_mode: device.auto_mode, on_time: e.target.value, off_time: offTime })
                                                                });
                                                            }}
                                                            className="bg-slate-800 text-slate-200 text-xs rounded px-2 py-1 border border-slate-600"
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-slate-500 text-xs">Spegni:</span>
                                                        <input
                                                            type="time"
                                                            defaultValue={device.off_time || "18:00"}
                                                            id={`off-time-${device.id}`}
                                                            onChange={async (e) => {
                                                                const onTime = document.getElementById(`on-time-${device.id}`)?.value || '08:00';
                                                                await fetch(`/api/chihiros/devices/${device.id}/auto-schedule`, {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ auto_mode: device.auto_mode, on_time: onTime, off_time: e.target.value })
                                                                });
                                                            }}
                                                            className="bg-slate-800 text-slate-200 text-xs rounded px-2 py-1 border border-slate-600"
                                                        />
                                                    </div>
                                                </div>
                                                <p className="text-[10px] text-slate-500 mt-2">
                                                    ℹ️ Usa i valori RGB impostati sopra per l'accensione automatica
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )
                }

                {/* VIEW: MANUTENZIONE - Calendar with maintenance events */}
                {activeTab === 'manutenzione' && (
                    <div className="max-w-4xl mx-auto p-6 space-y-6 overflow-y-auto h-full">
                        <div className="flex justify-between items-center">
                            <h2 className="text-2xl font-bold text-slate-100">📅 Manutenzione</h2>
                            <button onClick={() => setShowAddMaintenanceModal(true)} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium">+ Aggiungi Evento</button>
                        </div>

                        {/* Calendar Navigation */}
                        <div className="flex items-center justify-between bg-slate-800 rounded-xl p-4">
                            <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))} className="p-2 hover:bg-slate-700 rounded-lg text-slate-300">←</button>
                            <span className="text-lg font-medium text-slate-200">{calendarMonth.toLocaleString('it-IT', { month: 'long', year: 'numeric' })}</span>
                            <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))} className="p-2 hover:bg-slate-700 rounded-lg text-slate-300">→</button>
                        </div>

                        {/* Calendar Grid */}
                        <div className="bg-slate-800 rounded-xl p-4">
                            <div className="grid grid-cols-7 gap-1 mb-2">
                                {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => <div key={d} className="text-center text-xs text-slate-500 font-medium py-2">{d}</div>)}
                            </div>
                            <div className="grid grid-cols-7 gap-1">
                                {(() => {
                                    const year = calendarMonth.getFullYear();
                                    const month = calendarMonth.getMonth();
                                    const firstDay = new Date(year, month, 1).getDay() || 7;
                                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                                    const cells = [];
                                    for (let i = 1; i < firstDay; i++) cells.push(<div key={`e-${i}`} className="h-16"></div>);

                                    for (let day = 1; day <= daysInMonth; day++) {
                                        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                        const currentDayDate = new Date(year, month, day);
                                        currentDayDate.setHours(0, 0, 0, 0);

                                        // 1. Existing Log Events
                                        const logEvents = maintenanceLog.filter(e => e.date === dateStr);

                                        // 2. Projected Recurring Events
                                        const recurringEvents = maintenanceRules.filter(rule => {
                                            const startDate = new Date(rule.start_date);
                                            startDate.setHours(0, 0, 0, 0);

                                            if (currentDayDate < startDate) return false;

                                            if (rule.frequency === 'interval') {
                                                const diffTime = currentDayDate - startDate;
                                                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                                                return diffDays % (rule.interval || 1) === 0;
                                            } else if (rule.frequency === 'weekly') {
                                                // rule.weekdays is [0, 1, 2...] (Sun=0)
                                                // currentDayDate.getDay() (Sun=0)
                                                return rule.weekdays && rule.weekdays.includes(currentDayDate.getDay());
                                            } else if (rule.frequency === 'monthly') {
                                                const targetDom = rule.day_of_month || startDate.getDate();
                                                return currentDayDate.getDate() === targetDom;
                                            }
                                            return false;
                                        }).map(rule => ({
                                            id: `rec-${rule.id}-${dateStr}`,
                                            type: rule.type,
                                            isRecurring: true
                                        }));

                                        const allEvents = [...logEvents, ...recurringEvents];

                                        cells.push(
                                            <div key={day} className={`h-16 bg-slate-900/50 rounded p-1 text-xs ${allEvents.length > 0 ? 'border border-cyan-500/50' : ''}`}>
                                                <div className="text-slate-400 flex justify-between">
                                                    <span>{day}</span>
                                                    {allEvents.length > 0 && <span className="text-[9px] text-cyan-500">{allEvents.length}</span>}
                                                </div>
                                                <div className="overflow-y-auto max-h-[40px] scrollbar-none space-y-0.5">
                                                    {allEvents.slice(0, 3).map((e, i) => (
                                                        <div
                                                            key={i}
                                                            title={`${e.type} - ${e.description || 'Nessuna descrizione'}`}
                                                            className={`truncate text-[9px] px-1 rounded flex items-center gap-1 cursor-help ${e.type === 'water_change' ? 'bg-blue-500/30 text-blue-300' : e.type === 'filter_clean' ? 'bg-orange-500/30 text-orange-300' : e.type === 'fertilizer' ? 'bg-green-500/30 text-green-300' : 'bg-slate-600 text-slate-300'} ${e.isRecurring ? 'opacity-75 border border-dashed border-slate-500/30' : ''}`}
                                                        >
                                                            {e.isRecurring && <span className="text-[8px]">↻</span>}
                                                            {{
                                                                water_change: 'Cambio Acqua',
                                                                filter_clean: 'Pulizia Filtro',
                                                                fertilizer: 'Fertilizzante',
                                                                medication: 'Medicinale',
                                                                note: 'Nota'
                                                            }[e.type] || e.type}
                                                        </div>
                                                    ))}
                                                    {allEvents.length > 3 && (
                                                        <div className="text-[9px] text-slate-500 text-center leading-none">+{allEvents.length - 3}</div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    }
                                    return cells;
                                })()}
                            </div>
                        </div>

                        {/* Recurring Rules List */}
                        {maintenanceRules.length > 0 && (
                            <div className="bg-slate-800 rounded-xl p-4">
                                <h3 className="text-lg font-medium text-slate-200 mb-3">Pianificazioni Ricorrenti</h3>
                                <div className="space-y-2">
                                    {maintenanceRules.map(rule => (
                                        <div key={rule.id} className="flex items-center justify-between bg-slate-900/50 rounded-lg p-3 border-l-4 border-l-cyan-500">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-slate-200 text-sm">{rule.type === 'custom' ? rule.description : rule.type}</span>
                                                    <span className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                                                        {rule.frequency === 'interval' ? `Ogni ${rule.interval} giorni` : rule.frequency === 'weekly' ? 'Settimanale' : 'Mensile'}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-slate-500 mt-0.5">
                                                    Prossimo: {(() => {
                                                        // Quick calc for display
                                                        // Reuse logic or just show start date if simple
                                                        return new Date(rule.start_date).toLocaleDateString('it-IT');
                                                    })()} (Inizio)
                                                </div>
                                            </div>
                                            <button onClick={async () => {
                                                if (!confirm('Eliminare questa regola?')) return;
                                                await fetch(`${API_BASE}/maintenance/recurring/${rule.id}`, { method: 'DELETE' });
                                                const data = await fetch(`${API_BASE}/maintenance/recurring?tankId=${selectedTankId}`).then(r => r.json());
                                                setMaintenanceRules(data);
                                            }} className="text-red-400 hover:text-red-300 text-xs p-2 hover:bg-slate-800 rounded">✕</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Recent Events List */}
                        <div className="bg-slate-800 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-lg font-medium text-slate-200">Eventi Recenti</h3>
                                {maintenanceLog.length > 0 && (
                                    <button
                                        onClick={async () => {
                                            if (!confirm('Sei sicuro di voler eliminare TUTTO lo storico manutenzione? Questa azione è irreversibile.')) return;
                                            try {
                                                await fetch(`${API_BASE}/maintenance/all?tankId=${selectedTankId}`, { method: 'DELETE' });
                                                setMaintenanceLog([]);
                                            } catch (e) {
                                                alert('Errore eliminazione: ' + e.message);
                                            }
                                        }}
                                        className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 px-2 py-1 rounded hover:bg-red-500/10"
                                    >
                                        Elimina Tutto
                                    </button>
                                )}
                            </div>
                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                {maintenanceLog.slice(0, 10).map(event => (
                                    <div key={event.id} className="flex items-center justify-between bg-slate-900/50 rounded-lg p-3">
                                        <div className="flex items-center gap-3">
                                            <span className={`px-2 py-1 text-xs rounded ${event.type === 'water_change' ? 'bg-blue-500/30 text-blue-300' : event.type === 'filter_clean' ? 'bg-orange-500/30 text-orange-300' : event.type === 'fertilizer' ? 'bg-green-500/30 text-green-300' : 'bg-slate-600 text-slate-300'}`}>
                                                {{
                                                    water_change: 'Cambio Acqua',
                                                    filter_clean: 'Pulizia Filtro',
                                                    fertilizer: 'Fertilizzante',
                                                    medication: 'Medicinale',
                                                    note: 'Nota',
                                                    custom: event.description // fallback or just show type if custom?
                                                }[event.type] || event.type}
                                            </span>
                                            <span className="text-slate-400 text-sm">{event.date}</span>
                                            {event.reminder_time && <span className="text-cyan-500 text-xs font-mono bg-slate-800 px-1.5 py-0.5 rounded">⏰ {event.reminder_time}</span>}
                                            <span className="text-slate-300 text-sm truncate max-w-[200px]">{event.description}</span>
                                        </div>
                                        <button onClick={async () => { await fetch(`${API_BASE}/maintenance/${event.id}`, { method: 'DELETE' }); setMaintenanceLog(prev => prev.filter(e => e.id !== event.id)); }} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Add Maintenance Modal */}
                        {showAddMaintenanceModal && (
                            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
                                <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-700 shadow-2xl">
                                    <h3 className="text-xl font-bold text-slate-100 mb-4">Aggiungi Evento</h3>
                                    <form onSubmit={async (e) => {
                                        e.preventDefault();
                                        const form = e.target;
                                        const eventType = form.type.value === 'custom' ? form.customName.value : form.type.value;
                                        const desc = form.description.value;
                                        const date = form.date.value;

                                        if (isMaintenanceRecurring) {
                                            // Add Recurring Rule
                                            let weekdays = [];
                                            if (maintenanceFrequency === 'weekly') {
                                                const checkboxes = form.querySelectorAll('input[name="weekday"]:checked');
                                                checkboxes.forEach(cb => weekdays.push(parseInt(cb.value)));
                                            }

                                            await fetch(`${API_BASE}/maintenance/recurring`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    tankId: selectedTankId,
                                                    type: eventType,
                                                    description: desc,
                                                    frequency: maintenanceFrequency,
                                                    interval: parseInt(form.interval?.value || 1),
                                                    weekdays: weekdays,
                                                    start_date: date,
                                                    reminder_time: form.reminder.value
                                                })
                                            });

                                            // Refresh rules
                                            const rules = await fetch(`${API_BASE}/maintenance/recurring?tankId=${selectedTankId}`).then(r => r.json());
                                            setMaintenanceRules(rules);
                                        } else {
                                            // Add One-off
                                            await fetch(`${API_BASE}/maintenance`, {
                                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ date: date, type: eventType, description: desc, reminder_time: form.reminder.value, tankId: selectedTankId })
                                            });
                                            // Refresh log
                                            const logs = await fetch(`${API_BASE}/maintenance?tankId=${selectedTankId}`).then(r => r.json());
                                            setMaintenanceLog(logs);
                                        }

                                        setShowAddMaintenanceModal(false);
                                    }} className="space-y-4">

                                        <div className="flex items-center gap-2 mb-2 p-2 bg-slate-900/50 rounded-lg">
                                            <input
                                                type="checkbox"
                                                id="isRecurring"
                                                checked={isMaintenanceRecurring}
                                                onChange={(e) => setIsMaintenanceRecurring(e.target.checked)}
                                                className="rounded border-slate-600 bg-slate-800 text-cyan-600 focus:ring-cyan-500"
                                            />
                                            <label htmlFor="isRecurring" className="text-sm text-slate-300 font-medium select-none cursor-pointer">
                                                Ripeti questo evento (Pianificazione)
                                            </label>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <label className="text-xs text-slate-400 uppercase font-bold">Data {isMaintenanceRecurring ? 'Inizio' : ''}</label>
                                                <input type="date" name="date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" required />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs text-slate-400 uppercase font-bold flex items-center gap-1">
                                                    Orario Promemoria
                                                    <span className="text-[10px] text-slate-500 font-normal normal-case">(Opzionale)</span>
                                                </label>
                                                <input
                                                    type="time"
                                                    name="reminder"
                                                    className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-xs text-slate-400 uppercase font-bold">Tipo Evento</label>
                                            <select name="type" onChange={(e) => {
                                                const customInput = document.getElementsByName('customName')[0];
                                                if (customInput) customInput.style.display = e.target.value === 'custom' ? 'block' : 'none';
                                            }} className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" required>
                                                <option value="water_change">Cambio Acqua</option>
                                                <option value="filter_clean">Pulizia Filtro</option>
                                                <option value="fertilizer">Fertilizzante</option>
                                                <option value="medication">Medicinale</option>
                                                <option value="note">Nota</option>
                                                <option value="custom">Personalizzato</option>
                                            </select>
                                            <input type="text" name="customName" placeholder="Nome evento personalizzato" className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600 mt-2" style={{ display: 'none' }} />
                                        </div>

                                        {isMaintenanceRecurring && (
                                            <div className="p-3 bg-slate-900/50 rounded-lg space-y-3 border border-slate-700/50">
                                                <div className="space-y-1">
                                                    <label className="text-xs text-slate-400 uppercase font-bold">Frequenza</label>
                                                    <select
                                                        value={maintenanceFrequency}
                                                        onChange={(e) => setMaintenanceFrequency(e.target.value)}
                                                        className="w-full bg-slate-800 text-slate-200 rounded-lg px-3 py-2 border border-slate-600 text-sm"
                                                    >
                                                        <option value="interval">Intervallo Giorni</option>
                                                        <option value="weekly">Settimanale</option>
                                                        <option value="monthly">Mensile</option>
                                                    </select>
                                                </div>

                                                {maintenanceFrequency === 'interval' && (
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-slate-400 uppercase font-bold">Ogni quanti giorni?</label>
                                                        <input type="number" name="interval" defaultValue="7" min="1" className="w-full bg-slate-800 text-slate-200 rounded-lg px-3 py-2 border border-slate-600 text-sm" />
                                                    </div>
                                                )}

                                                {maintenanceFrequency === 'weekly' && (
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-slate-400 uppercase font-bold">Giorni della settimana</label>
                                                        <div className="flex gap-1 justify-between">
                                                            {['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'].map((d, i) => (
                                                                <label key={d} className="flex flex-col items-center cursor-pointer">
                                                                    <input type="checkbox" name="weekday" value={i} className="peer sr-only" />
                                                                    <span className="w-8 h-8 flex items-center justify-center rounded bg-slate-800 text-slate-400 text-xs peer-checked:bg-cyan-600 peer-checked:text-white transition-all border border-slate-700 peer-checked:border-cyan-500">
                                                                        {d.charAt(0)}
                                                                    </span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {maintenanceFrequency === 'monthly' && (
                                                    <p className="text-xs text-slate-500">L'evento si ripeterà lo stesso giorno del mese della data di inizio.</p>
                                                )}
                                            </div>
                                        )}

                                        <textarea name="description" placeholder="Descrizione / Note..." className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" rows="2"></textarea>

                                        <div className="flex gap-3 pt-2">
                                            <button type="button" onClick={() => setShowAddMaintenanceModal(false)} className="flex-1 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600">Annulla</button>
                                            <button type="submit" className="flex-1 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 font-bold">
                                                {isMaintenanceRecurring ? 'Crea Pianificazione' : 'Aggiungi Evento'}
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* VIEW: PARAMETRI - Water parameters with chart */}
                {activeTab === 'parametri' && (
                    <div className="h-full lg:h-[calc(100vh-110px)] w-full flex flex-col p-2 gap-2 overflow-y-auto lg:overflow-hidden">
                        <div className="shrink-0 flex justify-between items-center px-1 mb-1">
                            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                                💧 Parametri
                            </h2>
                            <button
                                onClick={() => setShowAddWaterParamsModal(true)}
                                className="px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg text-xs font-bold shadow-md shadow-cyan-900/20 transition-all flex items-center gap-1.5"
                            >
                                <Plus size={14} /> Nuova
                            </button>
                        </div>

                        {waterParams.length > 0 ? (() => {
                            const latest = waterParams[0];

                            // Fish Health Parameters
                            const fishParams = [
                                { key: 'ph', label: 'pH', color: 'cyan', unit: '' },
                                { key: 'gh', label: 'GH', color: 'blue', unit: 'dGH' },
                                { key: 'kh', label: 'KH', color: 'indigo', unit: 'dKH' },
                                { key: 'no2', label: 'NO₂', color: 'red', unit: 'mg/l' },
                                { key: 'nh3', label: 'NH₃', color: 'purple', unit: 'mg/l' },
                                { key: 'nh4', label: 'NH₄', color: 'fuchsia', unit: 'mg/l' },
                                { key: 'o2', label: 'O₂', color: 'sky', unit: 'mg/l' },
                                { key: 'cl', label: 'Cl', color: 'lime', unit: 'mg/l' },
                                { key: 'cu', label: 'Cu', color: 'orange', unit: 'mg/l' },
                                { key: 'ca', label: 'Ca', color: 'stone', unit: 'mg/l' },
                            ];

                            // Plant Health Parameters
                            const plantParams = [
                                { key: 'no3', label: 'NO₃', color: 'orange', unit: 'mg/l' },
                                { key: 'po4', label: 'PO₄', color: 'emerald', unit: 'mg/l' },
                                { key: 'fe', label: 'Fe', color: 'yellow', unit: 'mg/l' },
                                { key: 'k', label: 'K', color: 'violet', unit: 'mg/l' },
                                { key: 'mg', label: 'Mg', color: 'pink', unit: 'mg/l' },
                                { key: 'sio2', label: 'SiO₂', color: 'zinc', unit: 'mg/l' },
                                { key: 'co2', label: 'CO₂', color: 'teal', unit: 'ppm' },
                            ];

                            const redfield = calculateRedfield(latest.no3, latest.po4);
                            const calcCO2 = calculateCO2(latest.ph, latest.kh);

                            // Enrich waterParams with calculated CO2
                            const enrichedParams = waterParams.map(p => ({
                                ...p,
                                co2_display: (p.co2 !== null && p.co2 !== undefined && p.co2 !== '') ? p.co2 : '-', // Manual CO2
                                co2_computed: calculateCO2(p.ph, p.kh) // Calculated CO2
                            }));

                            return (
                                <div className="h-auto lg:flex-1 flex flex-col gap-2 lg:min-h-0 lg:overflow-hidden shrink-0">
                                    {/* Consolidated Health Dashboard */}
                                    <div className="h-auto lg:flex-1 lg:min-h-0 bg-slate-800/80 rounded-xl p-3 border border-slate-700/50 backdrop-blur-sm shadow-sm flex flex-col gap-2 lg:overflow-hidden">

                                        {/* Fish Section */}
                                        <div className="h-auto lg:flex-1 flex flex-col justify-start lg:justify-center lg:min-h-0">
                                            <div className="flex items-center gap-2 mb-2 shrink-0">
                                                <div className="p-1.5 bg-cyan-500/10 rounded-md text-cyan-400"><Fish size={16} /></div>
                                                <span className="text-xs font-bold uppercase text-slate-400">Salute Pesci</span>
                                            </div>
                                            <div className="grid grid-cols-[repeat(auto-fit,minmax(80px,1fr))] gap-3 flex-1 items-center">
                                                {fishParams.map(p => (
                                                    <div key={p.key} className={`bg-slate-900/60 rounded-xl p-2 border border-slate-700/50 flex flex-col items-center justify-center h-full transition-all ${latest[p.key] != null ? 'opacity-100' : 'opacity-30 grayscale'}`}>
                                                        <div className="text-xs font-bold text-slate-500 uppercase mb-1">{p.label}</div>
                                                        <div className="flex items-baseline gap-0.5">
                                                            <span className={`text-2xl font-bold text-${p.color}-400`}>{latest[p.key] ?? '-'}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Divider */}
                                        <div className="w-full h-px bg-slate-700/30"></div>

                                        {/* Plant Section */}
                                        <div className="h-auto lg:flex-1 flex flex-col justify-start lg:justify-center lg:min-h-0">
                                            <div className="flex justify-between items-center mb-2 shrink-0">
                                                <div className="flex items-center gap-2">
                                                    <div className="p-1.5 bg-green-500/10 rounded-md text-green-400"><Leaf size={16} /></div>
                                                    <span className="text-xs font-bold uppercase text-slate-400">Salute Piante</span>
                                                </div>
                                                <div className="flex gap-2">
                                                    {/* Redfield */}
                                                    <div className={`group relative px-2 py-1 sm:px-3 sm:py-2 rounded-lg border border-slate-700 bg-slate-900/50 flex items-center gap-1 sm:gap-2 ${redfield ? 'opacity-100' : 'opacity-50'}`} title="Rapporto Redfield = (NO3/PO4)*1.53. Ottimale tra 10 e 22 per prevenire alghe.">
                                                        <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                                                            Redfield
                                                            <Info size={10} className="text-slate-500 hover:text-cyan-400 cursor-help" />
                                                        </span>
                                                        {redfield ? (
                                                            <span className={`text-xs sm:text-sm font-bold ${redfield.color}`}>{redfield.value} ({redfield.label})</span>
                                                        ) : <span className="text-xs text-slate-500">--</span>}
                                                    </div>
                                                    {/* CO2 */}
                                                    <div className={`group relative px-2 py-1 sm:px-3 sm:py-2 rounded-lg border border-slate-700 bg-slate-900/50 flex items-center gap-1 sm:gap-2 ${calcCO2 ? 'opacity-100' : 'opacity-50'}`} title="CO2 stimata in base a pH e KH. Formula: 3 * KH * 10^(7-pH).">
                                                        <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                                                            CO₂
                                                            <Info size={10} className="text-slate-500 hover:text-cyan-400 cursor-help" />
                                                        </span>
                                                        {calcCO2 ? (
                                                            <span className="text-xs sm:text-sm font-bold text-teal-400">{calcCO2} ppm</span>
                                                        ) : <span className="text-xs text-slate-500">--</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-[repeat(auto-fit,minmax(80px,1fr))] gap-3 flex-1 items-center">
                                                {plantParams.map(p => (
                                                    <div key={p.key} className={`bg-slate-900/60 rounded-xl p-2 border border-slate-700/50 flex flex-col items-center justify-center h-full transition-all ${latest[p.key] != null ? 'opacity-100' : 'opacity-30 grayscale'}`}>
                                                        <div className="text-xs font-bold text-slate-500 uppercase mb-0.5">{p.label}</div>
                                                        <div className="flex items-baseline gap-0.5">
                                                            <span className={`text-xl font-bold text-${p.color}-400`}>{latest[p.key] ?? '-'}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* History Chart - Compact Height */}
                                    {/* Bottom Split Section: Chart & Table */}
                                    <div className="h-auto lg:flex-1 min-h-[500px] lg:min-h-0 flex flex-col md:flex-row gap-2 lg:overflow-hidden">

                                        {/* History Chart - Expanded to Fill Split */}
                                        <div className="flex-1 min-w-0 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50 shadow-sm flex flex-col">
                                            <h3 className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-2">
                                                <Activity size={12} className="text-cyan-400" />
                                                Grafico Andamento
                                            </h3>
                                            <div className="flex-1 w-full min-h-0">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={[...enrichedParams].reverse()} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} vertical={false} />
                                                        <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickFormatter={(val) => val.split('-').slice(1).reverse().join('/')} tickMargin={5} />
                                                        {/* Left Axis: Standard/Macro (pH, KH, GH, NO3, etc.) */}
                                                        <YAxis yAxisId="left" stroke="#64748b" fontSize={10} width={30} />
                                                        {/* Right Axis: Trace/Micro (NO2, NH3, PO4, Fe, etc.) */}
                                                        <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" fontSize={10} width={30} />

                                                        <Tooltip
                                                            contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px', padding: '4px' }}
                                                            itemStyle={{ padding: 0 }}
                                                        />
                                                        <Legend wrapperStyle={{ fontSize: '10px' }} iconSize={8} />

                                                        {/* Fish Parameters */}
                                                        <Line yAxisId="left" type="monotone" dataKey="ph" name="pH" stroke="#22d3ee" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="left" type="monotone" dataKey="gh" name="GH" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="left" type="monotone" dataKey="kh" name="KH" stroke="#6366f1" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="right" type="monotone" dataKey="no2" name="NO₂" stroke="#ef4444" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="right" type="monotone" dataKey="nh3" name="NH₃" stroke="#a855f7" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="right" type="monotone" dataKey="nh4" name="NH₄" stroke="#d946ef" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="left" type="monotone" dataKey="o2" name="O₂" stroke="#0ea5e9" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="right" type="monotone" dataKey="cl" name="Cl" stroke="#84cc16" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="right" type="monotone" dataKey="cu" name="Cu" stroke="#f97316" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="left" type="monotone" dataKey="ca" name="Ca" stroke="#a8a29e" strokeWidth={1.5} dot={false} connectNulls={true} />

                                                        {/* Plant Parameters */}
                                                        <Line yAxisId="left" type="monotone" dataKey="no3" name="NO₃" stroke="#f97316" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="right" type="monotone" dataKey="po4" name="PO₄" stroke="#10b981" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="right" type="monotone" dataKey="fe" name="Fe" stroke="#eab308" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="left" type="monotone" dataKey="k" name="K" stroke="#8b5cf6" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="left" type="monotone" dataKey="mg" name="Mg" stroke="#ec4899" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="left" type="monotone" dataKey="sio2" name="SiO₂" stroke="#71717a" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                        <Line yAxisId="left" type="monotone" dataKey="co2_computed" name="CO₂ (Calc)" stroke="#14b8a6" strokeWidth={1.5} dot={false} connectNulls={true} />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>

                                        {/* Full Data Table - Flexible with Internal Scroll */}
                                        <div className="flex-1 min-w-0 bg-slate-800/50 rounded-xl border border-slate-700/50 shadow-sm flex flex-col overflow-hidden">
                                            <div className="shrink-0 p-2 border-b border-slate-700/50 bg-slate-800/80 flex justify-between items-center">
                                                <h3 className="text-xs font-bold text-slate-300">Registro Completo</h3>
                                                <span className="text-[10px] text-slate-500">Scorri per vedere tutto</span>
                                            </div>
                                            <div className="flex-1 overflow-auto p-0 scrollbar-thin scrollbar-thumb-slate-700">
                                                <table className="w-full text-xs text-slate-300 whitespace-nowrap">
                                                    <thead className="bg-slate-900/90 sticky top-0 z-20 shadow-sm">
                                                        <tr className="text-slate-500">
                                                            <th className="text-left py-2 px-3 sticky left-0 bg-slate-900 border-r border-slate-800">Data</th>
                                                            <th className="px-2 text-cyan-400">pH</th>
                                                            <th className="px-2 text-blue-400">GH</th>
                                                            <th className="px-2 text-indigo-400">KH</th>
                                                            <th className="px-2 text-red-400">NO₂</th>
                                                            <th className="px-2 text-purple-400">NH₃</th>
                                                            <th className="px-2 text-fuchsia-400">NH₄</th>
                                                            <th className="px-2 text-sky-400">O₂</th>
                                                            <th className="px-2 text-orange-400 border-l border-slate-800">NO₃</th>
                                                            <th className="px-2 text-emerald-400">PO₄</th>
                                                            <th className="px-2 text-yellow-400">Fe</th>
                                                            <th className="px-2 text-violet-400">K</th>
                                                            <th className="px-2 text-teal-400">CO₂ (Mis.)</th>
                                                            <th className="px-2 text-teal-400/80 border-l border-slate-800/50">CO₂ (Calc.)</th>
                                                            <th className="px-2 text-center sticky right-0 bg-slate-900 border-l border-slate-800">Azioni</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-700/30">
                                                        {enrichedParams.map(p => (
                                                            <tr key={p.id} className="hover:bg-slate-700/20 transition-colors">
                                                                <td className="py-2 px-3 font-mono text-slate-400 sticky left-0 bg-slate-800/95 border-r border-slate-700/30">{p.date}</td>
                                                                <td className="text-center py-1">{p.ph ?? '-'}</td>
                                                                <td className="text-center py-1">{p.gh ?? '-'}</td>
                                                                <td className="text-center py-1">{p.kh ?? '-'}</td>
                                                                <td className="text-center py-1">{p.no2 ?? '-'}</td>
                                                                <td className="text-center py-1">{p.nh3 ?? '-'}</td>
                                                                <td className="text-center py-1">{p.nh4 ?? '-'}</td>
                                                                <td className="text-center py-1">{p.o2 ?? '-'}</td>
                                                                <td className="text-center py-1 border-l border-slate-700/30">{p.no3 ?? '-'}</td>
                                                                <td className="text-center py-1">{p.po4 ?? '-'}</td>
                                                                <td className="text-center py-1">{p.fe ?? '-'}</td>
                                                                <td className="text-center py-1">{p.k ?? '-'}</td>
                                                                <td className="text-center py-1">{p.co2_display}</td>
                                                                <td className="text-center py-1 border-l border-slate-700/30 font-medium text-teal-400/90">{p.co2_computed ?? '-'}</td>
                                                                <td className="text-center px-2 sticky right-0 bg-slate-800/95 border-l border-slate-700/30">
                                                                    <button
                                                                        onClick={() => {
                                                                            setEditingWaterParams(p);
                                                                            setShowAddWaterParamsModal(true);
                                                                        }}
                                                                        className="text-slate-500 hover:text-cyan-400 p-1 mr-1"
                                                                    >
                                                                        <Edit2 size={12} />
                                                                    </button>
                                                                    <button
                                                                        onClick={async () => {
                                                                            if (confirm('Eliminare questa misurazione?')) {
                                                                                await fetch(`${API_BASE}/water-params/${p.id}`, { method: 'DELETE' });
                                                                                setWaterParams(prev => prev.filter(e => e.id !== p.id));
                                                                            }
                                                                        }}
                                                                        className="text-slate-500 hover:text-red-400 p-1"
                                                                    >
                                                                        <Trash2 size={12} />
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })() : (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-slate-800/30 rounded-xl border-2 border-dashed border-slate-700/50 m-4">
                                <div className="p-4 bg-slate-800 rounded-full mb-3 shadow-lg">
                                    <Droplets size={24} className="text-slate-600" />
                                </div>
                                <h3 className="text-md font-medium text-slate-300">Nessun dato</h3>
                                <p className="text-xs text-slate-500 mt-1 mb-4">Inizia a tracciare i parametri dell'acqua.</p>
                                <button onClick={() => { setEditingWaterParams(null); setShowAddWaterParamsModal(true); }} className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-lg text-sm font-bold shadow-lg">
                                    + Aggiungi Prima Misurazione
                                </button>
                            </div>
                        )}
                    </div>
                )
                }

                {/* Add Water Params Modal - UPDATED */}
                {
                    showAddWaterParamsModal && (
                        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
                            <div className="bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-slate-700">
                                <div className="p-5 border-b border-slate-700 flex justify-between items-center bg-slate-900/50">
                                    <h3 className="text-xl font-bold text-slate-100">{editingWaterParams ? 'Modifica Misurazione' : 'Nuova Misurazione'}</h3>
                                    <button onClick={() => { setShowAddWaterParamsModal(false); setEditingWaterParams(null); }} className="text-slate-400 hover:text-white">✕</button>
                                </div>

                                <div className="overflow-y-auto p-6">
                                    <form id="addParamsForm" onSubmit={async (e) => {
                                        e.preventDefault();
                                        const formData = new FormData(e.target);
                                        const data = Object.fromEntries(formData.entries());

                                        await fetch(`${API_BASE}/water-params${editingWaterParams ? `/${editingWaterParams.id}` : ''}`, {
                                            method: editingWaterParams ? 'PUT' : 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ ...data, tankId: selectedTankId })
                                        });

                                        // Refresh params
                                        const res = await fetch(`${API_BASE}/water-params?tankId=${selectedTankId}`);
                                        const json = await res.json();
                                        setWaterParams(json);

                                        setShowAddWaterParamsModal(false);
                                        setEditingWaterParams(null);
                                    }}>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="col-span-1 md:col-span-2">
                                                <label className="block text-xs font-medium text-slate-400 mb-1">Data *</label>
                                                <input required name="date" type="date" defaultValue={editingWaterParams?.date || new Date().toISOString().split('T')[0]} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500" />
                                            </div>

                                            {/* Fish Section */}
                                            <div className="space-y-4">
                                                <h4 className="text-sm font-bold text-cyan-400 uppercase tracking-wide border-b border-slate-700 pb-2">Salute Pesci</h4>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">pH</label>
                                                        <input name="ph" type="number" step="0.1" placeholder="8.0" defaultValue={editingWaterParams?.ph || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">NO₂ (Nitriti)</label>
                                                        <input name="no2" type="number" step="0.01" placeholder="0.00" defaultValue={editingWaterParams?.no2 || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">NH₃ (Ammoniaca)</label>
                                                        <input name="nh3" type="number" step="0.01" placeholder="0.00" defaultValue={editingWaterParams?.nh3 || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">NH₄ (Ammonio)</label>
                                                        <input name="nh4" type="number" step="0.01" placeholder="0.00" defaultValue={editingWaterParams?.nh4 || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">GH</label>
                                                        <input name="gh" type="number" step="1" placeholder="8" defaultValue={editingWaterParams?.gh || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">KH</label>
                                                        <input name="kh" type="number" step="1" placeholder="8" defaultValue={editingWaterParams?.kh || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">O₂ (Ossigeno)</label>
                                                        <input name="o2" type="number" step="0.1" placeholder="8.0" defaultValue={editingWaterParams?.o2 || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">Cl (Cloro)</label>
                                                        <input name="cl" type="number" step="0.1" placeholder="0.0" defaultValue={editingWaterParams?.cl || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">Cu (Rame)</label>
                                                        <input name="cu" type="number" step="0.01" placeholder="0.00" defaultValue={editingWaterParams?.cu || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">Ca (Calcio)</label>
                                                        <input name="ca" type="number" step="1" placeholder="420" defaultValue={editingWaterParams?.ca || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Plant Section */}
                                            <div className="space-y-4">
                                                <h4 className="text-sm font-bold text-green-400 uppercase tracking-wide border-b border-slate-700 pb-2">Salute Piante</h4>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">NO₃ (Nitrati)</label>
                                                        <input name="no3" type="number" step="1" placeholder="10" defaultValue={editingWaterParams?.no3 || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">PO₄ (Fosfati)</label>
                                                        <input name="po4" type="number" step="0.01" placeholder="0.10" defaultValue={editingWaterParams?.po4 || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">Fe (Ferro)</label>
                                                        <input name="fe" type="number" step="0.01" placeholder="0.10" defaultValue={editingWaterParams?.fe || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">K (Potassio)</label>
                                                        <input name="k" type="number" step="1" placeholder="10" defaultValue={editingWaterParams?.k || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">Mg (Magnesio)</label>
                                                        <input name="mg" type="number" step="1" placeholder="10" defaultValue={editingWaterParams?.mg || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">SiO₂ (Silicati)</label>
                                                        <input name="sio2" type="number" step="0.1" placeholder="0.0" defaultValue={editingWaterParams?.sio2 || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-400 mb-1">CO₂ (Misurata)</label>
                                                        <input name="co2" type="number" step="1" placeholder="30" defaultValue={editingWaterParams?.co2 || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
                                                    </div>
                                                </div>

                                                <div className="pt-2">
                                                    <label className="block text-xs text-slate-400 mb-1">Note</label>
                                                    <textarea name="notes" rows="2" defaultValue={editingWaterParams?.notes || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" placeholder="Optional notes..."></textarea>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="p-5 border-t border-slate-700 bg-slate-900/50 flex justify-end gap-3">
                                            <button onClick={() => setShowAddWaterParamsModal(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Annulla</button>
                                            <button type="submit" form="addParamsForm" className="px-6 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-cyan-900/20">Salva Misurazione</button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    )
                }



                {/* VIEW: PESCI - Fish inventory */}
                {
                    activeTab === 'pesci' && (
                        <div className="w-full h-full p-6 space-y-6 overflow-y-auto">
                            <div className="flex justify-between items-center">
                                <h2 className="text-2xl font-bold text-slate-100">🐠 Inventario Pesci</h2>
                                <div className="flex items-center gap-3">

                                    <button onClick={() => { setEditingFish(null); setDragDropPreview(null); setShowAddFishModal(true); }} className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-700/50 bg-cyan-600 text-white rounded-lg text-sm font-medium px-4 py-2">+ Aggiungi Pesce</button>
                                </div>
                            </div>

                            {/* Fish Grid */}
                            {/* Fish Grid */}
                            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4 transition-all duration-300">
                                {fishInventory.map(fish => (
                                    <div key={fish.id} className={`bg-slate-800 rounded-xl p-4 border ${fish.status === 'alive' ? 'border-green-500/30' : fish.status === 'deceased' ? 'border-red-500/30' : 'border-slate-600'}`}>
                                        {fish.photo_url && (
                                            <img src={fish.photo_url} alt={fish.name} className="w-full h-48 object-cover rounded-lg mb-3" />
                                        )}
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="font-bold text-slate-200 text-lg">{fish.name}</h3>
                                                <p className="text-sm text-slate-400">{fish.species}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs px-2 py-0.5 rounded ${fish.status === 'alive' ? 'bg-green-500/20 text-green-400' : fish.status === 'deceased' ? 'bg-red-500/20 text-red-400' : 'bg-slate-600 text-slate-300'}`}>{fish.status}</span>
                                                <button onClick={() => { setEditingFish(fish); setDragDropPreview(fish.photo_url); setShowAddFishModal(true); }} className="text-cyan-400 hover:text-cyan-300 mr-1"><Edit2 size={16} /></button>
                                                <button onClick={async () => { await fetch(`${API_BASE}/fish/${fish.id}`, { method: 'DELETE' }); setFishInventory(prev => prev.filter(f => f.id !== fish.id)); }} className="text-red-400 hover:text-red-300">✕</button>
                                            </div>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-400">
                                            <span>Qtà: {fish.quantity}</span>
                                            <span>Aggiunto: {fish.date_added}</span>
                                            {fish.price && <span>€{fish.price}</span>}
                                        </div>
                                        {fish.notes && <p className="mt-2 text-sm text-slate-500">{fish.notes}</p>}
                                    </div>
                                ))}
                            </div>

                            {fishInventory.length === 0 && (
                                <div className="text-center py-12 bg-slate-800 rounded-xl">
                                    <span className="text-4xl">🐠</span>
                                    <p className="text-slate-400 mt-2">Nessun pesce registrato</p>
                                </div>
                            )}

                            {/* Add Fish Modal */}
                            {showAddFishModal && (
                                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
                                    <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md">
                                        <h3 className="text-xl font-bold text-slate-100 mb-4">{editingFish ? 'Modifica Pesce' : 'Aggiungi Pesce'}</h3>
                                        <form onSubmit={async (e) => {
                                            e.preventDefault();
                                            const f = e.target;
                                            const photoFile = f.photo.files[0];
                                            let photoUrl = editingFish?.photo_url || null; // Extend existing photo if no new one

                                            // 1. Priority: Dragged URL/Image content
                                            if (f.dragged_photo_url && f.dragged_photo_url.value) {
                                                photoUrl = f.dragged_photo_url.value;
                                            }
                                            // 2. Fallback: Standard File Input
                                            else if (photoFile) {
                                                // Convert to WebP for smaller size
                                                const img = new Image();
                                                const imgUrl = URL.createObjectURL(photoFile);
                                                await new Promise((resolve) => {
                                                    img.onload = () => {
                                                        const canvas = document.createElement('canvas');
                                                        const ctx = canvas.getContext('2d');

                                                        // Resize if too large (max 800px width)
                                                        const maxWidth = 800;
                                                        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
                                                        canvas.width = img.width * scale;
                                                        canvas.height = img.height * scale;

                                                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                                        photoUrl = canvas.toDataURL('image/webp', 0.8); // 80% quality WebP
                                                        URL.revokeObjectURL(imgUrl);
                                                        resolve();
                                                    };
                                                    img.src = imgUrl;
                                                });
                                            }

                                            const payload = {
                                                name: f.name.value,
                                                species: f.species.value,
                                                quantity: parseInt(f.quantity.value) || 1,
                                                price: parseFloat(f.price.value) || null,
                                                photo_url: photoUrl,
                                                notes: f.notes.value,
                                                tankId: selectedTankId,
                                                status: f.status_select ? f.status_select.value : (editingFish?.status || 'alive')
                                            };

                                            if (editingFish) {
                                                await fetch(`${API_BASE}/fish/${editingFish.id}`, {
                                                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify(payload)
                                                });
                                            } else {
                                                await fetch(`${API_BASE}/fish`, {
                                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify(payload)
                                                });
                                            }

                                            const data = await fetch(`${API_BASE}/fish?tankId=${selectedTankId}`).then(r => r.json());
                                            setFishInventory(data);
                                            setShowAddFishModal(false);
                                            setEditingFish(null);
                                        }} className="space-y-4">
                                            <input type="text" name="name" placeholder="Nome" defaultValue={editingFish?.name || ''} className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" required />
                                            <input type="text" name="species" placeholder="Specie" defaultValue={editingFish?.species || ''} className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" />
                                            <div className="grid grid-cols-2 gap-3">
                                                <input type="number" name="quantity" placeholder="Quantità" defaultValue={editingFish?.quantity || 1} min="1" className="bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" />
                                                <input type="number" name="price" step="0.01" placeholder="Prezzo €" defaultValue={editingFish?.price || ''} className="bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" />
                                            </div>

                                            {editingFish && (
                                                <select name="status_select" defaultValue={editingFish.status} className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600">
                                                    <option value="alive">Vivo</option>
                                                    <option value="deceased">Deceduto</option>
                                                    <option value="sold">Venduto</option>
                                                    <option value="quarantine">In Quarantena</option>
                                                </select>
                                            )}

                                            <div>
                                                <label className="block text-xs text-slate-500 mb-1">Foto (Trascina un'immagine o URL qui)</label>

                                                <div
                                                    className={`w-full h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors relative overflow-hidden ${isDragging ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-600 bg-slate-900 hover:border-slate-500'
                                                        }`}
                                                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                                    onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                                                    onDrop={async (e) => {
                                                        e.preventDefault();
                                                        setIsDragging(false);

                                                        let file = e.dataTransfer.files[0];
                                                        let url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');

                                                        // Handle File Drop
                                                        if (file && file.type.startsWith('image/')) {
                                                            const img = new Image();
                                                            const imgUrl = URL.createObjectURL(file);
                                                            img.onload = () => {
                                                                const canvas = document.createElement('canvas');
                                                                const ctx = canvas.getContext('2d');
                                                                const maxWidth = 800;
                                                                const scale = img.width > maxWidth ? maxWidth / img.width : 1;
                                                                canvas.width = img.width * scale;
                                                                canvas.height = img.height * scale;
                                                                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                                                const webpUrl = canvas.toDataURL('image/webp', 0.8);
                                                                setDragDropPreview(webpUrl);
                                                                URL.revokeObjectURL(imgUrl);
                                                            };
                                                            img.src = imgUrl;
                                                        }
                                                        // Handle URL Drop (e.g. from Google Images)
                                                        else if (url) {
                                                            // Verify it's an image URL or trying to be
                                                            // Simple check, we trust the visual preview
                                                            setDragDropPreview(url);
                                                        }
                                                    }}
                                                    onClick={() => document.getElementById('fishPhotoInput').click()}
                                                >
                                                    {dragDropPreview || editingFish?.photo_url ? (
                                                        <>
                                                            <img src={dragDropPreview || editingFish?.photo_url} alt="Preview" className="w-full h-full object-cover opacity-60" />
                                                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                                                <p className="text-xs text-white font-medium">Clicca o trascina per cambiare</p>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <UploadCloud className="w-8 h-8 text-slate-500 mb-2" />
                                                            <p className="text-xs text-slate-400 text-center px-4">
                                                                Drop image file or URL here<br />
                                                                <span className="text-[10px] opacity-70">(o clicca per sfogliare)</span>
                                                            </p>
                                                        </>
                                                    )}
                                                </div>

                                                <input
                                                    id="fishPhotoInput"
                                                    type="file"
                                                    name="photo"
                                                    accept="image/*"
                                                    className="hidden"
                                                    onChange={(e) => {
                                                        const file = e.target.files[0];
                                                        if (file) {
                                                            const img = new Image();
                                                            const imgUrl = URL.createObjectURL(file);
                                                            img.onload = () => {
                                                                const canvas = document.createElement('canvas');
                                                                const ctx = canvas.getContext('2d');
                                                                const maxWidth = 800;
                                                                const scale = img.width > maxWidth ? maxWidth / img.width : 1;
                                                                canvas.width = img.width * scale;
                                                                canvas.height = img.height * scale;
                                                                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                                                const webpUrl = canvas.toDataURL('image/webp', 0.8);
                                                                setDragDropPreview(webpUrl);
                                                                URL.revokeObjectURL(imgUrl);
                                                            };
                                                            img.src = imgUrl;
                                                        }
                                                    }}
                                                />
                                                {/* Hidden input to hold the final URL for submission */}
                                                <input type="hidden" name="dragged_photo_url" value={dragDropPreview || ''} />
                                            </div>
                                            <textarea name="notes" placeholder="Note..." defaultValue={editingFish?.notes || ''} className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" rows="2"></textarea>
                                            <div className="flex gap-3">
                                                <button type="button" onClick={() => { setShowAddFishModal(false); setEditingFish(null); setDragDropPreview(null); }} className="flex-1 py-2 bg-slate-700 text-slate-300 rounded-lg">Annulla</button>
                                                <button type="submit" className="flex-1 py-2 bg-cyan-600 text-white rounded-lg">Salva</button>
                                            </div>
                                        </form>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                }

                {/* VIEW: PLANTS */}
                {
                    activeTab === 'piante' && (
                        <div className="w-full h-full p-4 flex flex-col gap-4 overflow-hidden">
                            <div className="flex justify-between items-center shrink-0">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                                        <Leaf className="text-green-400" /> Inventario Piante
                                    </h2>
                                    <p className="text-slate-400 text-sm">Gestisci le piante del tuo acquario</p>
                                </div>
                                <div className="flex items-center gap-4">

                                    <button onClick={() => { setEditingPlant(null); setDragDropPreview(null); setShowAddPlantModal(true); }} className="text-green-400 hover:text-green-300 hover:bg-green-700/50 bg-green-600 text-white rounded-lg text-sm font-medium px-4 py-2">+ Aggiungi Pianta</button>
                                </div>
                            </div>

                            {/* Plants Grid */}
                            {/* Plants Grid */}
                            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4 transition-all duration-300">
                                {plantsInventory.map(plant => (
                                    <div key={plant.id} className={`bg-slate-800 rounded-xl p-4 border ${plant.status === 'optimal' ? 'border-green-500/30' : plant.status === 'melting' ? 'border-red-500/30' : 'border-slate-600'}`}>
                                        {plant.photo_url && (
                                            <img src={plant.photo_url} alt={plant.name} className="w-full h-48 object-cover rounded-lg mb-3" />
                                        )}
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="font-bold text-slate-200 text-lg">{plant.name}</h3>
                                                <p className="text-sm text-slate-400">{plant.species}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs px-2 py-0.5 rounded ${plant.status === 'optimal' ? 'bg-green-500/20 text-green-400' : plant.status === 'melting' ? 'bg-red-500/20 text-red-400' : 'bg-slate-600 text-slate-300'}`}>{plant.status}</span>
                                                <button onClick={() => { setEditingPlant(plant); setDragDropPreview(plant.photo_url); setShowAddPlantModal(true); }} className="text-cyan-400 hover:text-cyan-300 mr-1"><Edit2 size={16} /></button>
                                                <button onClick={async () => { if (confirm('Eliminare questa pianta?')) { await fetch(`${API_BASE}/plants/${plant.id}`, { method: 'DELETE' }); setPlantsInventory(prev => prev.filter(p => p.id !== plant.id)); } }} className="text-red-400 hover:text-red-300">✕</button>
                                            </div>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-400">
                                            <span>Qtà: {plant.quantity}</span>
                                            <span>Aggiunto: {plant.date_added}</span>
                                            {plant.price && <span>€{plant.price}</span>}
                                        </div>
                                        {plant.notes && <p className="mt-2 text-sm text-slate-500">{plant.notes}</p>}
                                    </div>
                                ))}
                            </div>

                            {plantsInventory.length === 0 && (
                                <div className="text-center py-12 bg-slate-800 rounded-xl">
                                    <span className="text-4xl">🌿</span>
                                    <p className="text-slate-400 mt-2">Nessuna pianta registrata</p>
                                </div>
                            )}

                            {/* Add Plant Modal */}
                            {showAddPlantModal && (
                                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
                                    <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md">
                                        <h3 className="text-xl font-bold text-slate-100 mb-4">{editingPlant ? 'Modifica Pianta' : 'Aggiungi Pianta'}</h3>
                                        <form onSubmit={async (e) => {
                                            e.preventDefault();
                                            const f = e.target;
                                            const photoFile = f.photo.files[0];
                                            let photoUrl = editingPlant?.photo_url || null;

                                            if (f.dragged_photo_url && f.dragged_photo_url.value) {
                                                photoUrl = f.dragged_photo_url.value;
                                            }
                                            else if (photoFile) {
                                                const img = new Image();
                                                const imgUrl = URL.createObjectURL(photoFile);
                                                await new Promise((resolve) => {
                                                    img.onload = () => {
                                                        const canvas = document.createElement('canvas');
                                                        const ctx = canvas.getContext('2d');
                                                        const maxWidth = 800;
                                                        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
                                                        canvas.width = img.width * scale;
                                                        canvas.height = img.height * scale;
                                                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                                        photoUrl = canvas.toDataURL('image/webp', 0.8);
                                                        URL.revokeObjectURL(imgUrl);
                                                        resolve();
                                                    };
                                                    img.src = imgUrl;
                                                });
                                            }

                                            const payload = {
                                                name: f.name.value,
                                                species: f.species.value,
                                                quantity: parseInt(f.quantity.value) || 1,
                                                price: parseFloat(f.price.value) || null,
                                                photo_url: photoUrl,
                                                notes: f.notes.value,
                                                tankId: selectedTankId,
                                                status: f.status_select ? f.status_select.value : (editingPlant?.status || 'optimal')
                                            };

                                            if (editingPlant) {
                                                await fetch(`${API_BASE}/plants/${editingPlant.id}`, {
                                                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify(payload)
                                                });
                                            } else {
                                                await fetch(`${API_BASE}/plants`, {
                                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify(payload)
                                                });
                                            }

                                            const data = await fetch(`${API_BASE}/plants?tankId=${selectedTankId}`).then(r => r.json());
                                            setPlantsInventory(data);
                                            setShowAddPlantModal(false);
                                            setEditingPlant(null);
                                        }} className="space-y-4">
                                            <input type="text" name="name" placeholder="Nome" defaultValue={editingPlant?.name || ''} className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" required />
                                            <input type="text" name="species" placeholder="Specie" defaultValue={editingPlant?.species || ''} className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" />
                                            <div className="grid grid-cols-2 gap-3">
                                                <input type="number" name="quantity" placeholder="Quantità" defaultValue={editingPlant?.quantity || 1} min="1" className="bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" />
                                                <input type="number" name="price" step="0.01" placeholder="Prezzo €" defaultValue={editingPlant?.price || ''} className="bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" />
                                            </div>

                                            <select name="status_select" defaultValue={editingPlant?.status || 'optimal'} className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600">
                                                <option value="optimal">Ottimale</option>
                                                <option value="growing">In Crescita</option>
                                                <option value="propagating">Propagazione</option>
                                                <option value="melting">Melting / Sofferente</option>
                                            </select>

                                            <div>
                                                <label className="block text-xs text-slate-500 mb-1">Foto (Trascina un'immagine o URL qui)</label>

                                                <div
                                                    className={`w-full h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors relative overflow-hidden ${isDragging ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-600 bg-slate-900 hover:border-slate-500'}`}
                                                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                                    onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                                                    onDrop={async (e) => {
                                                        e.preventDefault();
                                                        setIsDragging(false);
                                                        let file = e.dataTransfer.files[0];
                                                        let url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');

                                                        if (file && file.type.startsWith('image/')) {
                                                            const img = new Image();
                                                            const imgUrl = URL.createObjectURL(file);
                                                            img.onload = () => {
                                                                const canvas = document.createElement('canvas');
                                                                const ctx = canvas.getContext('2d');
                                                                const maxWidth = 800;
                                                                const scale = img.width > maxWidth ? maxWidth / img.width : 1;
                                                                canvas.width = img.width * scale;
                                                                canvas.height = img.height * scale;
                                                                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                                                const webpUrl = canvas.toDataURL('image/webp', 0.8);
                                                                setDragDropPreview(webpUrl);
                                                                URL.revokeObjectURL(imgUrl);
                                                            };
                                                            img.src = imgUrl;
                                                        }
                                                        else if (url) {
                                                            setDragDropPreview(url);
                                                        }
                                                    }}
                                                    onClick={() => document.getElementById('plantPhotoInput').click()}
                                                >
                                                    {dragDropPreview || editingPlant?.photo_url ? (
                                                        <>
                                                            <img src={dragDropPreview || editingPlant?.photo_url} alt="Preview" className="w-full h-full object-cover opacity-60" />
                                                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                                                <p className="text-xs text-white font-medium">Clicca o trascina per cambiare</p>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <UploadCloud className="w-8 h-8 text-slate-500 mb-2" />
                                                            <p className="text-xs text-slate-400 text-center px-4">
                                                                Drop image file or URL here<br />
                                                                <span className="text-[10px] opacity-70">(o clicca per sfogliare)</span>
                                                            </p>
                                                        </>
                                                    )}
                                                </div>

                                                <input
                                                    id="plantPhotoInput"
                                                    type="file"
                                                    name="photo"
                                                    accept="image/*"
                                                    className="hidden"
                                                    onChange={(e) => {
                                                        const file = e.target.files[0];
                                                        if (file) {
                                                            const img = new Image();
                                                            const imgUrl = URL.createObjectURL(file);
                                                            img.onload = () => {
                                                                const canvas = document.createElement('canvas');
                                                                const ctx = canvas.getContext('2d');
                                                                const maxWidth = 800;
                                                                const scale = img.width > maxWidth ? maxWidth / img.width : 1;
                                                                canvas.width = img.width * scale;
                                                                canvas.height = img.height * scale;
                                                                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                                                const webpUrl = canvas.toDataURL('image/webp', 0.8);
                                                                setDragDropPreview(webpUrl);
                                                                URL.revokeObjectURL(imgUrl);
                                                            };
                                                            img.src = imgUrl;
                                                        }
                                                    }}
                                                />
                                                <input type="hidden" name="dragged_photo_url" value={dragDropPreview || ''} />
                                            </div>
                                            <textarea name="notes" placeholder="Note..." defaultValue={editingPlant?.notes || ''} className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600" rows="2"></textarea>
                                            <div className="flex gap-3">
                                                <button type="button" onClick={() => { setShowAddPlantModal(false); setEditingPlant(null); setDragDropPreview(null); }} className="flex-1 py-2 bg-slate-700 text-slate-300 rounded-lg">Annulla</button>
                                                <button type="submit" className="flex-1 py-2 bg-green-600 text-white rounded-lg">Salva</button>
                                            </div>
                                        </form>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                }

                {/* VIEW: ALERTS */}
                {
                    activeTab === 'alert' && (
                        <div className="w-full h-full p-4 flex flex-col gap-4 overflow-y-auto lg:overflow-hidden">
                            <div className="flex justify-between items-center">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-100">Sistema Alert</h2>
                                    <p className="text-slate-400 text-sm">Configura notifiche per parametri e dispositivi</p>
                                </div>
                                <button
                                    onClick={() => {
                                        const newState = !notificationSettings.enabled;
                                        const newSettings = { ...notificationSettings, enabled: newState };
                                        setNotificationSettings(newSettings);
                                        saveNotificationSettings(newSettings);
                                    }}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all ${notificationSettings.enabled
                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                        : 'bg-slate-700 text-slate-400 border border-slate-600'
                                        }`}
                                >
                                    {notificationSettings.enabled ? <Bell className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                                    {notificationSettings.enabled ? 'Attivo' : 'Disattivato'}
                                </button>
                            </div>

                            <div className="flex flex-col h-auto lg:h-full lg:overflow-hidden gap-4">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-auto lg:h-[65%] lg:min-h-0 shrink-0">
                                    {/* Notification Provider Settings */}
                                    <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-6 flex flex-col lg:overflow-hidden">
                                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                            <Bell size={16} /> Configurazione Notifiche
                                        </h3>

                                        <div className="h-auto lg:h-full">
                                            <div className="flex gap-4 mb-4">
                                                <button
                                                    onClick={() => setNotificationSettings(prev => ({ ...prev, provider: 'ntfy' }))}
                                                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${notificationSettings.provider === 'ntfy'
                                                        ? 'bg-cyan-500 text-white'
                                                        : 'bg-slate-700 text-slate-400'
                                                        }`}
                                                >
                                                    ntfy
                                                </button>
                                                <button
                                                    onClick={() => setNotificationSettings(prev => ({ ...prev, provider: 'telegram' }))}
                                                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${notificationSettings.provider === 'telegram'
                                                        ? 'bg-cyan-500 text-white'
                                                        : 'bg-slate-700 text-slate-400'
                                                        }`}
                                                >
                                                    Telegram
                                                </button>
                                            </div>
                                            <p className="text-xs text-slate-500 mb-4">
                                                💡 Configura entrambi per ricevere notifiche su più canali contemporaneamente
                                            </p>

                                            <div className="mt-4">
                                                {/* ntfy Config */}
                                                {notificationSettings.provider === 'ntfy' && (
                                                    <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                                                        <h4 className="font-medium text-slate-300 mb-3">Configurazione ntfy</h4>
                                                        <div className="space-y-3">
                                                            <div>
                                                                <label className="text-xs text-slate-500 uppercase font-bold">Server</label>
                                                                <input
                                                                    type="text"
                                                                    value={notificationSettings.ntfy_server}
                                                                    onChange={e => setNotificationSettings(prev => ({ ...prev, ntfy_server: e.target.value }))}
                                                                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 mt-1"
                                                                    placeholder="https://ntfy.sh"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs text-slate-500 uppercase font-bold">Topic</label>
                                                                <input
                                                                    type="text"
                                                                    value={notificationSettings.ntfy_topic || ''}
                                                                    onChange={e => setNotificationSettings(prev => ({ ...prev, ntfy_topic: e.target.value }))}
                                                                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 mt-1"
                                                                    placeholder="aquamind-alerts"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Telegram Config */}
                                                {notificationSettings.provider === 'telegram' && (
                                                    <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                                                        <h4 className="font-medium text-slate-300 mb-3">Configurazione Telegram</h4>
                                                        <div className="space-y-3">
                                                            <div>
                                                                <label className="text-xs text-slate-500 uppercase font-bold">Bot Token</label>
                                                                <input
                                                                    type="password"
                                                                    value={notificationSettings.telegram_bot_token || ''}
                                                                    onChange={e => setNotificationSettings(prev => ({ ...prev, telegram_bot_token: e.target.value }))}
                                                                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 mt-1"
                                                                    placeholder="123456789:ABC..."
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs text-slate-500 uppercase font-bold">Chat ID</label>
                                                                <input
                                                                    type="text"
                                                                    value={notificationSettings.telegram_chat_id || ''}
                                                                    onChange={e => setNotificationSettings(prev => ({ ...prev, telegram_chat_id: e.target.value }))}
                                                                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 mt-1"
                                                                    placeholder="-1001234567890"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-4 border-t border-slate-700">
                                                <div className="flex items-center gap-4">
                                                    <label className="flex items-center gap-2 text-sm text-slate-300">
                                                        <input
                                                            type="checkbox"
                                                            checked={notificationSettings.notify_device_triggers}
                                                            onChange={e => setNotificationSettings(prev => ({ ...prev, notify_device_triggers: e.target.checked }))}
                                                            className="w-4 h-4 rounded"
                                                        />
                                                        Trigger dispositivi
                                                    </label>
                                                    <label className="flex items-center gap-2 text-sm text-slate-300">
                                                        <input
                                                            type="checkbox"
                                                            checked={notificationSettings.notify_thresholds}
                                                            onChange={e => setNotificationSettings(prev => ({ ...prev, notify_thresholds: e.target.checked }))}
                                                            className="w-4 h-4 rounded"
                                                        />
                                                        Soglie
                                                    </label>
                                                    <label className="flex items-center gap-2 text-sm text-slate-300">
                                                        <input
                                                            type="checkbox"
                                                            checked={notificationSettings.notify_delta}
                                                            onChange={e => setNotificationSettings(prev => ({ ...prev, notify_delta: e.target.checked }))}
                                                            className="w-4 h-4 rounded"
                                                        />
                                                        Variazioni rapide
                                                    </label>
                                                </div>

                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={saveNotificationSettings}
                                                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-colors"
                                                    >
                                                        Salva Impostazioni
                                                    </button>
                                                    <button
                                                        onClick={testNotification}
                                                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg font-medium transition-colors"
                                                    >
                                                        Test Notifica
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Threshold Configuration */}
                                    <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-6 flex flex-col lg:overflow-hidden h-auto lg:h-full">
                                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                            <AlertTriangle size={16} /> Soglie Parametri
                                        </h3>

                                        <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4 h-auto lg:h-full lg:overflow-y-auto pr-2 custom-scrollbar">
                                            {parameterDefs.map(param => {
                                                const existing = alertThresholds.find(t => t.parameter === param.id);
                                                return (
                                                    <div key={param.id} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                                                        <div className="flex justify-between items-center mb-3">
                                                            <span className="font-medium text-slate-200">{param.name}</span>
                                                            <button
                                                                onClick={() => {
                                                                    if (existing && existing.enabled) {
                                                                        saveThreshold({ ...existing, enabled: false });
                                                                    } else if (existing) {
                                                                        saveThreshold({ ...existing, enabled: true });
                                                                    } else {
                                                                        saveThreshold({
                                                                            parameter: param.id,
                                                                            min_value: param.defaultMin,
                                                                            max_value: param.defaultMax,
                                                                            delta_value: null,
                                                                            delta_minutes: 5,
                                                                            enabled: true
                                                                        });
                                                                    }
                                                                }}
                                                                className={`text-xs px-2 py-1 rounded ${existing?.enabled
                                                                    ? 'bg-emerald-500/20 text-emerald-400'
                                                                    : 'bg-slate-700 text-slate-500'
                                                                    }`}
                                                            >
                                                                {existing?.enabled ? 'Attivo' : 'Disattivo'}
                                                            </button>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                                            <div>
                                                                <label className="text-[10px] text-slate-500 uppercase">Min</label>
                                                                <input
                                                                    type="number"
                                                                    step="any"
                                                                    value={existing?.min_value ?? param.defaultMin}
                                                                    onChange={e => saveThreshold({
                                                                        ...existing,
                                                                        parameter: param.id,
                                                                        min_value: parseFloat(e.target.value) || null,
                                                                        enabled: existing?.enabled ?? true
                                                                    })}
                                                                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-200"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="text-[10px] text-slate-500 uppercase">Max</label>
                                                                <input
                                                                    type="number"
                                                                    step="any"
                                                                    value={existing?.max_value ?? param.defaultMax}
                                                                    onChange={e => saveThreshold({
                                                                        ...existing,
                                                                        parameter: param.id,
                                                                        max_value: parseFloat(e.target.value) || null,
                                                                        enabled: existing?.enabled ?? true
                                                                    })}
                                                                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-200"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="text-[10px] text-slate-500 uppercase">Delta (±)</label>
                                                                <input
                                                                    type="number"
                                                                    step="any"
                                                                    value={existing?.delta_value ?? ''}
                                                                    onChange={e => saveThreshold({
                                                                        ...existing,
                                                                        parameter: param.id,
                                                                        delta_value: parseFloat(e.target.value) || null,
                                                                        enabled: existing?.enabled ?? true
                                                                    })}
                                                                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-200"
                                                                    placeholder="N/A"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="text-[10px] text-slate-500 uppercase">in Min</label>
                                                                <input
                                                                    type="number"
                                                                    value={existing?.delta_minutes ?? 5}
                                                                    onChange={e => saveThreshold({
                                                                        ...existing,
                                                                        parameter: param.id,
                                                                        delta_minutes: parseInt(e.target.value) || 5,
                                                                        enabled: existing?.enabled ?? true
                                                                    })}
                                                                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-200"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>

                                {/* Alert Log */}
                                <div className="h-auto lg:flex-1 min-h-[400px] lg:min-h-0 bg-slate-800 rounded-xl border border-slate-700/50 p-6 flex flex-col lg:overflow-hidden">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                            <Activity size={16} /> Log Alert
                                        </h3>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={clearAlertLog}
                                                className="text-xs text-red-400 hover:text-red-300"
                                                title="Elimina tutto"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                            <button
                                                onClick={refreshAlertLog}
                                                className="text-xs text-cyan-400 hover:text-cyan-300"
                                            >
                                                Aggiorna
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-2 flex-1 overflow-y-auto custom-scrollbar pr-2">
                                        {alertLog.length === 0 ? (
                                            <p className="text-slate-500 text-sm text-center py-4">Nessun alert recente</p>
                                        ) : alertLog.map(log => (
                                            <div key={log.id} className="flex items-start gap-3 p-2 bg-slate-900/50 rounded-lg text-sm">
                                                <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${log.type.includes('threshold') ? 'bg-amber-400' :
                                                    log.type === 'delta' ? 'bg-purple-400' :
                                                        'bg-cyan-400'
                                                    }`} />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-slate-300 truncate">{log.message}</p>
                                                    <p className="text-[10px] text-slate-500 mt-1">
                                                        {new Date(log.timestamp).toLocaleString('it-IT')}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* VIEW: HISTORY */}
                {
                    activeTab === 'storico' && (
                        <div className="w-full h-full flex flex-col px-2 lg:px-4 overflow-y-auto lg:overflow-hidden">
                            <div className="mb-4 flex justify-center lg:justify-between items-center flex-wrap gap-4 text-center lg:text-left">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-100">Storico Dati</h2>
                                    <p className="text-slate-400 text-sm">Visualizza l'andamento dei parametri nel tempo</p>
                                </div>
                                <div className="flex flex-col lg:flex-row gap-4 items-center flex-wrap justify-center w-full lg:w-auto">
                                    {/* Parameter Selector Dropdown */}
                                    <div className="relative">
                                        <select
                                            multiple
                                            value={visibleParams}
                                            onChange={(e) => {
                                                const selected = Array.from(e.target.selectedOptions, opt => opt.value);
                                                if (selected.length > 0) setVisibleParams(selected);
                                            }}
                                            className="hidden"
                                            id="paramSelector"
                                        />
                                        <div className="flex items-center justify-center flex-nowrap lg:flex-wrap gap-1 lg:gap-2 w-full lg:w-auto bg-slate-800 rounded-lg px-2 py-2 border border-slate-700">
                                            <span className="text-[10px] sm:text-xs text-slate-400 uppercase font-bold whitespace-nowrap flex-shrink-0">Parametri:</span>
                                            {[
                                                { key: 'temp', label: 'Temp', color: '#f43f5e' },
                                                { key: 'ph', label: 'pH', color: '#22d3ee' },
                                                { key: 'tds', label: 'TDS', color: '#fbbf24' },
                                                { key: 'level', label: 'Livello', color: '#22c55e' }
                                            ].map(param => (
                                                <div key={param.key} className="flex items-center bg-slate-900/50 rounded-md overflow-hidden border border-slate-700/50 flex-shrink-0">
                                                    <button
                                                        onClick={() => {
                                                            if (visibleParams.includes(param.key)) {
                                                                if (visibleParams.length > 1) {
                                                                    setVisibleParams(visibleParams.filter(p => p !== param.key));
                                                                }
                                                            } else {
                                                                setVisibleParams([...visibleParams, param.key]);
                                                            }
                                                        }}
                                                        className={`px-1.5 sm:px-2 py-1 text-[10px] sm:text-xs font-medium transition-all ${visibleParams.includes(param.key)
                                                            ? 'opacity-100'
                                                            : 'opacity-40 hover:opacity-70'
                                                            }`}
                                                        style={{
                                                            color: param.color,
                                                        }}
                                                    >
                                                        {param.label}
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); clearHistory(param.key); }}
                                                        className="px-1.5 py-1 text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors border-l border-slate-700/50"
                                                        title={`Elimina storico ${param.label}`}
                                                    >
                                                        <Trash2 size={10} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Time Range Selector */}
                                    <div className="flex gap-1 flex-wrap justify-center">
                                        {historyRangeOptions.map(opt => (
                                            <button
                                                key={opt.hours}
                                                onClick={() => setHistoryRange(opt.hours)}
                                                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${historyRange === opt.hours
                                                    ? 'bg-cyan-500 text-white'
                                                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                                    }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="h-[250px] lg:h-auto lg:flex-1 bg-slate-800 rounded-2xl border border-slate-700/50 p-2 lg:p-4 lg:overflow-hidden flex flex-col shrink-0">
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                        <Activity size={16} />
                                        Telemetria - {historyRangeOptions.find(o => o.hours === historyRange)?.label || '24h'}
                                    </h3>
                                    <button
                                        onClick={() => clearHistory()}
                                        className="text-xs text-red-400 hover:text-red-300 px-2 py-1 hover:bg-red-500/10 rounded flex items-center gap-1 border border-transparent hover:border-red-500/20 transition-all"
                                        title="Elimina TUTTO lo storico"
                                    >
                                        <Trash2 size={14} /> <span className="hidden sm:inline">Elimina Tutto</span>
                                    </button>
                                </div>
                                <div className="flex-1 min-h-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={historyData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                            <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} interval="preserveStartEnd" />

                                            {/* Left Y-Axis for Temperature */}
                                            {visibleParams.includes('temp') && (
                                                <YAxis yAxisId="temp" stroke="#f43f5e" fontSize={10} tickLine={false}
                                                    domain={['dataMin - 1', 'dataMax + 1']} orientation="left" />
                                            )}

                                            {/* Right Y-Axis for pH */}
                                            {visibleParams.includes('ph') && (
                                                <YAxis yAxisId="ph" stroke="#22d3ee" fontSize={10} tickLine={false}
                                                    domain={[0, 14]} orientation="right" />
                                            )}

                                            {/* Additional axes for salinity/level if needed */}
                                            {visibleParams.includes('tds') && !visibleParams.includes('temp') && (
                                                <YAxis yAxisId="tds" stroke="#fbbf24" fontSize={10} tickLine={false}
                                                    domain={['dataMin - 10', 'dataMax + 10']} orientation="left" />
                                            )}

                                            {visibleParams.includes('level') && !visibleParams.includes('ph') && (
                                                <YAxis yAxisId="level" stroke="#22c55e" fontSize={10} tickLine={false}
                                                    domain={[0, 100]} orientation="right" />
                                            )}

                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '6px', fontSize: '12px' }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: '12px' }} />

                                            {visibleParams.includes('temp') && (
                                                <Line yAxisId="temp" type="monotone" dataKey="temp" stroke="#f43f5e"
                                                    strokeWidth={2} dot={false} name="Temperatura (°C)" connectNulls={true} />
                                            )}
                                            {visibleParams.includes('ph') && (
                                                <Line yAxisId="ph" type="monotone" dataKey="ph" stroke="#22d3ee"
                                                    strokeWidth={2} dot={false} name="pH" connectNulls={true} />
                                            )}
                                            {visibleParams.includes('tds') && (
                                                <Line yAxisId={visibleParams.includes('temp') ? 'temp' : 'tds'}
                                                    type="monotone" dataKey="tds" stroke="#fbbf24"
                                                    strokeWidth={2} dot={false} name="TDS (ppm)" connectNulls={true} />
                                            )}
                                            {visibleParams.includes('level') && (
                                                <Line yAxisId={visibleParams.includes('ph') ? 'ph' : 'level'}
                                                    type="monotone" dataKey="level" stroke="#22c55e"
                                                    strokeWidth={2} dot={false} name="Livello (%)" connectNulls={true} />
                                            )}
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Min/Max Statistics */}
                            {historyData.length > 0 && (
                                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {[
                                        { key: 'temp', label: 'Temperatura', unit: '°C', color: '#f43f5e', decimals: 1 },
                                        { key: 'ph', label: 'pH', unit: '', color: '#22d3ee', decimals: 2 },
                                        { key: 'tds', label: 'TDS', unit: 'ppm', color: '#fbbf24', decimals: 0 },
                                        { key: 'level', label: 'Livello', unit: '%', color: '#22c55e', decimals: 0 }
                                    ].filter(p => visibleParams.includes(p.key)).map(param => {
                                        // Get current value from last history point
                                        const values = historyData
                                            .map(d => d[param.key])
                                            .filter(v => v !== null && v !== undefined);
                                        const current = values.length > 0 ? values[values.length - 1] : null;

                                        // Get stats from backend
                                        const stat = historyStats && historyStats[param.key];

                                        // Fallback if no stats (shouldn't happen with new backend)
                                        if (!stat) return null;

                                        const formatTime = (ts) => {
                                            if (!ts) return '';
                                            return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                                        };

                                        return (
                                            <div
                                                key={param.key}
                                                className="bg-slate-800 border border-slate-700/50 rounded-xl p-3"
                                                style={{ borderLeftColor: param.color, borderLeftWidth: '3px' }}
                                            >
                                                <div className="flex justify-between items-center mb-2">
                                                    <div className="text-xs font-bold uppercase tracking-wider" style={{ color: param.color }}>
                                                        {param.label}
                                                    </div>
                                                    <div className="text-[10px] bg-slate-700/50 px-1.5 py-0.5 rounded text-slate-400">
                                                        Δ {stat.delta?.toFixed(param.decimals)}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-2">
                                                    {/* Top: Current Value */}
                                                    <div className="flex flex-col items-center justify-center bg-slate-900/40 rounded-lg p-2 border border-slate-700/30">
                                                        <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">Attuale</div>
                                                        <div className="text-lg sm:text-xl font-bold text-slate-100">
                                                            {current?.toFixed(param.decimals)}{param.unit}
                                                        </div>
                                                    </div>

                                                    {/* Bottom: Min/Max Grid */}
                                                    <div className="grid grid-cols-2 gap-2 text-center">
                                                        <div className="bg-slate-900/20 rounded p-1.5 flex flex-col justify-between">
                                                            <div className="text-[10px] text-slate-500 uppercase">Min</div>
                                                            <div className="text-sm font-bold text-blue-400 my-0.5">
                                                                {stat.min?.toFixed(param.decimals)}{param.unit}
                                                            </div>
                                                            <div className="text-[9px] text-slate-600 font-mono">
                                                                {formatTime(stat.minAt)}
                                                            </div>
                                                        </div>
                                                        <div className="bg-slate-900/20 rounded p-1.5 flex flex-col justify-between">
                                                            <div className="text-[10px] text-slate-500 uppercase">Max</div>
                                                            <div className="text-sm font-bold text-red-400 my-0.5">
                                                                {stat.max?.toFixed(param.decimals)}{param.unit}
                                                            </div>
                                                            <div className="text-[9px] text-slate-600 font-mono">
                                                                {formatTime(stat.maxAt)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )
                }

                {/* VIEW: RECIPES */}
                {
                    activeTab === 'ricette' && (
                        <div className="w-full h-full p-4 flex gap-4 overflow-hidden relative">
                            {/* Recipes List - Hidden on Mobile if viewing recipe */}
                            <div className={`w-full md:w-1/3 md:min-w-[300px] h-full flex flex-col bg-slate-800 rounded-xl border border-slate-700/50 ${viewingRecipe ? 'hidden md:flex' : 'flex'}`}>
                                <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800 rounded-t-xl">
                                    <h3 className="font-bold text-slate-100 flex items-center gap-2">
                                        <BookOpen className="w-5 h-5 text-cyan-400" />
                                        Guide & Ricette
                                    </h3>
                                    <button onClick={loadRecipes} className="text-slate-500 hover:text-cyan-400 p-2 hover:bg-slate-700 rounded-lg transition-colors" title="Ricarica">
                                        <RefreshCw size={16} />
                                    </button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                                    {recipes.length > 0 ? (
                                        recipes.map(r => (
                                            <div key={r.id}
                                                onClick={() => setViewingRecipe(r)}
                                                className={`p-4 rounded-xl cursor-pointer transition-all border ${viewingRecipe?.id === r.id ? 'bg-slate-700 border-cyan-500/50' : 'bg-slate-900/50 border-slate-700 hover:bg-slate-700/50 hover:border-slate-600'}`}
                                            >
                                                <div className="flex justify-between items-start mb-1">
                                                    <h4 className={`font-medium text-sm line-clamp-2 ${viewingRecipe?.id === r.id ? 'text-cyan-400' : 'text-slate-200'}`}>{r.title}</h4>
                                                    <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 capitalize ml-2 shrink-0 border border-slate-700">{r.category || 'Gen'}</span>
                                                </div>
                                                <div className="text-[10px] text-slate-500 flex justify-between items-center mt-2">
                                                    <span>{new Date(r.created_at).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-10 opacity-50 px-4 text-center">
                                            <BookOpen className="w-10 h-10 mb-2 text-slate-600" />
                                            <p className="text-sm text-slate-500">Nessuna ricetta salvata.</p>
                                            <p className="text-xs text-slate-600 mt-1">Chiedi all'AI di salvare le tue procedure preferite.</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Recipe Detail - Hidden on Mobile if NOT viewing recipe */}
                            <div className={`w-full md:flex-1 h-full bg-slate-800 rounded-xl border border-slate-700/50 flex flex-col overflow-hidden relative ${!viewingRecipe ? 'hidden md:flex' : 'flex'}`}>
                                {viewingRecipe ? (
                                    <>
                                        <div className="p-3 md:p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800 z-10 shadow-sm">
                                            <div className="flex items-center gap-2 flex-1 overflow-hidden">
                                                {/* Back Button Mobile */}
                                                <button onClick={() => setViewingRecipe(null)} className="md:hidden p-1 mr-1 text-slate-400 hover:text-white">
                                                    <ChevronLeft size={20} />
                                                </button>
                                                <h2 className="font-bold text-lg md:text-xl text-cyan-400 truncate">{viewingRecipe.title}</h2>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className="text-xs bg-cyan-900/30 text-cyan-400 px-3 py-1 rounded-full border border-cyan-500/20 capitalize font-medium">{viewingRecipe.category || 'Generale'}</span>
                                                <button
                                                    onClick={() => handleDeleteRecipe(viewingRecipe.id)}
                                                    className="text-slate-400 hover:text-red-400 hover:bg-red-500/10 p-2 rounded-lg transition-colors ml-2"
                                                    title="Elimina Ricetta"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
                                            <div className="prose prose-invert prose-cyan max-w-4xl mx-auto">
                                                <SimpleMarkdownRenderer content={viewingRecipe.content} />
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                                        <div className="w-20 h-20 bg-slate-900/50 rounded-full flex items-center justify-center mb-6 border border-slate-700">
                                            <BookOpen className="w-10 h-10 text-slate-600" />
                                        </div>
                                        <h3 className="text-lg font-medium text-slate-300">Nessuna ricetta selezionata</h3>
                                        <p className="text-slate-500 text-sm mt-1 max-w-xs text-center">Seleziona una guida dall'elenco a sinistra per visualizzarne i dettagli.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                }

                {/* Add Tank Modal */}

                {
                    isAddTankModalOpen && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
                            <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-700 shadow-2xl">
                                <h3 className="text-xl font-bold text-slate-100 mb-4">{editingTank ? 'Modifica Acquario' : 'Aggiungi Nuovo Acquario'}</h3>
                                <form onSubmit={handleAddTank} className="space-y-4">
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase font-bold block mb-1">Nome Acquario</label>
                                        <input type="text" name="tankName" defaultValue={editingTank?.name || ''} placeholder="Es. Acquario Salotto" className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600 focus:border-cyan-500 outline-none" required />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase font-bold block mb-1">Tipo Controller</label>
                                        <select
                                            name="tankType"
                                            className={`w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600 focus:border-cyan-500 outline-none ${editingTank?.id === 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            value={newTankType}
                                            onChange={(e) => setNewTankType(e.target.value)}
                                            disabled={editingTank?.id === 1}
                                        >
                                            <option value="esp32_wifi">ESP32 (Wi-Fi)</option>
                                            <option value="arduino_local">ESP32-C3 (USB)</option>
                                        </select>
                                        {editingTank?.id === 1 && (
                                            <p className="text-[10px] text-amber-500 mt-1 flex items-center gap-1">
                                                <AlertTriangle size={10} />
                                                Il Main Aquarium (ID 1) utilizza ESP32-C3 (USB).
                                            </p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="text-xs text-slate-400 uppercase font-bold block mb-1">Tipo Acqua</label>
                                        <div className="flex gap-4">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="waterType"
                                                    value="freshwater"
                                                    defaultChecked={!editingTank || editingTank.water_type !== 'marine'}
                                                    className="w-4 h-4 text-cyan-500 bg-slate-700 border-slate-600 focus:ring-cyan-600 focus:ring-2"
                                                />
                                                <span className="text-slate-200 text-sm">Acqua Dolce</span>
                                            </label>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="waterType"
                                                    value="marine"
                                                    defaultChecked={editingTank?.water_type === 'marine'}
                                                    className="w-4 h-4 text-cyan-500 bg-slate-700 border-slate-600 focus:ring-cyan-600 focus:ring-2"
                                                />
                                                <span className="text-slate-200 text-sm">Acqua Salata (Marino)</span>
                                            </label>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-xs text-slate-400 uppercase font-bold block mb-1">
                                            {newTankType === 'esp32_wifi' ? 'Indirizzo IP ESP32' : 'Porta Seriale (USB)'}
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                name="tankAddress"
                                                defaultValue={editingTank?.address || ''}
                                                placeholder={newTankType === 'esp32_wifi' ? "Es. 192.168.1.50" : "Es. COM3 o /dev/ttyACM0"}
                                                className="flex-1 bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600 focus:border-cyan-500 outline-none"
                                                id="tankAddressInput"
                                            />
                                            {newTankType === 'esp32_wifi' && (
                                                <button
                                                    type="button"
                                                    onClick={scanForDevices}
                                                    disabled={isScanningDevices}
                                                    className="px-3 bg-slate-700 hover:bg-slate-600 text-cyan-400 rounded-lg border border-slate-600 transition-colors disabled:opacity-50"
                                                    title="Scansiona Rete"
                                                >
                                                    {isScanningDevices ? (
                                                        <RefreshCw className="w-5 h-5 animate-spin" />
                                                    ) : (
                                                        <Search className="w-5 h-5" />
                                                    )}
                                                </button>
                                            )}
                                        </div>

                                        {/* Discovered Devices List */}
                                        {newTankType === 'esp32_wifi' && discoveredDevices.length > 0 && (
                                            <div className="mt-2 space-y-1">
                                                <div className="text-[10px] text-slate-500 uppercase font-bold">Dispositivi Trovati:</div>
                                                {discoveredDevices.map((device, idx) => (
                                                    <button
                                                        key={idx}
                                                        type="button"
                                                        onClick={() => {
                                                            const input = document.getElementById('tankAddressInput');
                                                            if (input) input.value = device.ip;
                                                        }}
                                                        className="w-full text-left bg-slate-900/50 hover:bg-slate-700/50 border border-slate-700/50 rounded px-2 py-1.5 flex justify-between items-center group transition-colors"
                                                    >
                                                        <span className="text-xs text-cyan-300 font-mono">{device.name}</span>
                                                        <span className="text-xs text-slate-500 group-hover:text-slate-300">{device.ip}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        <p className="text-[10px] text-slate-500 mt-1">
                                            {newTankType === 'esp32_wifi'
                                                ? "L'IP serve per collegare l'ESP32. Usa 'Scansiona' per trovarlo automaticamente."
                                                : "La porta seriale/USB a cui è collegato l'ESP32-C3."}
                                        </p>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase font-bold block mb-1">URL Camera (Opzionale)</label>
                                        <input
                                            type="text"
                                            name="cameraUrl"
                                            defaultValue={editingTank?.camera_url || ''}
                                            placeholder={newTankType === 'esp32_wifi' ? "Es. rtsp://192.168.1.50/live o http://..." : "Es. /dev/video1 o rtsp://..."}
                                            className="w-full bg-slate-900 text-slate-200 rounded-lg px-4 py-2 border border-slate-600 focus:border-cyan-500 outline-none"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="col-span-2 text-xs text-slate-400 uppercase font-bold mb-1">Dimensioni Vasca e Attrezzatura</div>
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">Larghezza (cm)</label>
                                            <input
                                                type="number"
                                                name="width"
                                                value={newTankDims.width}
                                                onChange={(e) => {
                                                    const w = e.target.value;
                                                    const h = newTankDims.height;
                                                    const d = newTankDims.depth;
                                                    const v = (w && h && d) ? ((w * h * d) / 1000).toFixed(1) : newTankDims.volume;
                                                    setNewTankDims({ ...newTankDims, width: w, volume: v });
                                                }}
                                                placeholder="60"
                                                className="w-full bg-slate-900 text-slate-200 rounded-lg px-3 py-2 border border-slate-600 focus:border-cyan-500 outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">Altezza (cm)</label>
                                            <input
                                                type="number"
                                                name="height"
                                                value={newTankDims.height}
                                                onChange={(e) => {
                                                    const h = e.target.value;
                                                    const w = newTankDims.width;
                                                    const d = newTankDims.depth;
                                                    const v = (w && h && d) ? ((w * h * d) / 1000).toFixed(1) : newTankDims.volume;
                                                    setNewTankDims({ ...newTankDims, height: h, volume: v });
                                                }}
                                                placeholder="40"
                                                className="w-full bg-slate-900 text-slate-200 rounded-lg px-3 py-2 border border-slate-600 focus:border-cyan-500 outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">Profondità (cm)</label>
                                            <input
                                                type="number"
                                                name="depth"
                                                value={newTankDims.depth}
                                                onChange={(e) => {
                                                    const d = e.target.value;
                                                    const w = newTankDims.width;
                                                    const h = newTankDims.height;
                                                    const v = (w && h && d) ? ((w * h * d) / 1000).toFixed(1) : newTankDims.volume;
                                                    setNewTankDims({ ...newTankDims, depth: d, volume: v });
                                                }}
                                                placeholder="30"
                                                className="w-full bg-slate-900 text-slate-200 rounded-lg px-3 py-2 border border-slate-600 focus:border-cyan-500 outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">Volume (Litri)</label>
                                            <input
                                                type="number"
                                                name="volume"
                                                value={newTankDims.volume}
                                                onChange={(e) => setNewTankDims({ ...newTankDims, volume: e.target.value })}
                                                placeholder="72"
                                                className="w-full bg-slate-900 text-cyan-400 font-bold rounded-lg px-3 py-2 border border-slate-600 focus:border-cyan-500 outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">Wattaggio Luci (W)</label>
                                            <input
                                                type="number"
                                                step="0.1"
                                                name="light_watts"
                                                defaultValue={editingTank?.light_watts || ''}
                                                placeholder="Es. 45"
                                                className="w-full bg-slate-900 text-slate-200 rounded-lg px-3 py-2 border border-slate-600 focus:border-cyan-500 outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">Riscaldatore (W)</label>
                                            <input
                                                type="number"
                                                step="5"
                                                name="heater_watts"
                                                defaultValue={editingTank?.heater_watts || ''}
                                                placeholder="Es. 100"
                                                className="w-full bg-slate-900 text-slate-200 rounded-lg px-3 py-2 border border-slate-600 focus:border-cyan-500 outline-none"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex gap-3 pt-2">
                                        <button type="button" onClick={() => { setIsAddTankModalOpen(false); setEditingTank(null); }} className="flex-1 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors">Annulla</button>
                                        <button type="submit" className="flex-1 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors font-bold">{editingTank ? 'Salva Modifiche' : 'Crea Acquario'}</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )
                }

                {/* Manage Tanks Modal */}
                {
                    isManageTanksModalOpen && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
                            <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-700 shadow-2xl">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-xl font-bold text-slate-100">Gestione Vasche</h3>
                                    <button onClick={() => setIsManageTanksModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
                                </div>
                                <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                                    {tanks.map(tank => (
                                        <div key={tank.id} className="bg-slate-900 rounded-lg p-3 border border-slate-700">
                                            <div className="flex justify-between items-center mb-3">
                                                <div>
                                                    <div className="font-bold text-slate-200">{tank.name}</div>
                                                    <div className="text-xs text-slate-500">
                                                        {tank.type} • ID: {tank.id}
                                                        {tank.firmware_version && <span className="ml-2 text-cyan-500 bg-cyan-900/30 px-1 rounded">v{tank.firmware_version}</span>}
                                                    </div>
                                                    {tank.address && <div className="text-xs text-slate-600 font-mono mt-0.5">{tank.address}</div>}
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => {
                                                            setEditingTank(tank);
                                                            setNewTankType(tank.type);
                                                            setNewTankDims({
                                                                width: tank.width || '',
                                                                height: tank.height || '',
                                                                depth: tank.depth || '',
                                                                volume: tank.volume || ''
                                                            });
                                                            setIsAddTankModalOpen(true);
                                                            setIsManageTanksModalOpen(false);
                                                        }}
                                                        className="p-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded-lg transition-colors"
                                                        title="Modifica"
                                                    >
                                                        <Edit3 className="w-4 h-4" />
                                                    </button>
                                                    {tank.id !== 1 && (
                                                        <button
                                                            onClick={() => handleDeleteTank(tank.id)}
                                                            className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                                                            title="Elimina"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Firmware Update Section */}
                                            <div className="bg-slate-950/50 rounded p-2 border border-slate-800">
                                                <div className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                                                    <Zap className="w-3 h-3" /> Aggiorna Firmware
                                                </div>
                                                <form onSubmit={async (e) => {
                                                    e.preventDefault();
                                                    const form = e.target;
                                                    const file = form.firmware.files[0];
                                                    // Default platform based on type, but allow override if USB
                                                    let platform = tank.type === 'esp32_wifi' ? 'esp32' : 'arduino';

                                                    // If tank is local (USB), the user might have selected ESP32 or Arduino manually
                                                    if (tank.type === 'arduino_local' && form.platform) {
                                                        platform = form.platform.value;
                                                    }

                                                    if (!file) return alert("Seleziona un file .bin o .hex");
                                                    if (!confirm(`Aggiornare il firmware di ${tank.name}?`)) return;

                                                    const formData = new FormData();
                                                    formData.append('firmware', file);
                                                    formData.append('platform', platform);

                                                    try {
                                                        const btn = form.querySelector('button[type="submit"]');
                                                        const originalText = btn.innerText;
                                                        btn.disabled = true;
                                                        btn.innerText = "Aggiornamento...";

                                                        const res = await fetch(`${API_BASE}/tanks/${tank.id}/firmware`, {
                                                            method: 'POST',
                                                            body: formData
                                                        });
                                                        const data = await res.json();
                                                        alert(data.message || (data.success ? "Successo" : "Errore"));
                                                        btn.disabled = false;
                                                        btn.innerText = originalText;
                                                        form.reset();
                                                    } catch (err) {
                                                        console.error(err);
                                                        alert("Errore durante l'aggiornamento: " + err.message);
                                                    }
                                                }} className="space-y-2">
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="file"
                                                            name="firmware"
                                                            accept=".bin,.hex"
                                                            className="flex-1 text-xs text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-cyan-400 hover:file:bg-slate-700"
                                                            required
                                                        />
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        {tank.type === 'arduino_local' && (
                                                            <select
                                                                name="platform"
                                                                className="bg-slate-800 text-xs text-slate-300 rounded px-2 py-1 border border-slate-700 outline-none"
                                                            >
                                                                <option value="esp32">ESP32 (USB)</option>
                                                            </select>
                                                        )}

                                                        <button type="submit" className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold py-1 px-3 rounded transition-colors">
                                                            Avvia Update
                                                        </button>
                                                    </div>
                                                </form>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )
                }

            </main >
        </div >
    );
};

export default App;
