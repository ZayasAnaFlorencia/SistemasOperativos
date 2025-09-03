// Simulador de Gestión de Procesos y Memoria
// Configuración (adaptada del código Python)
const CONFIG = {
    MEM_TOTAL: 1024,
    TICK_MS: 500,
    NEW_PROC_PROB: 0.4,  // probabilidad de generar un nuevo proceso por tick
    MIN_PROC_MEM: 20,
    MAX_PROC_MEM: 300,
    MIN_CPU_BURST: 3,    // ticks
    MAX_CPU_BURST: 15,
    IO_PROB: 0.15,       // probabilidad de que un proceso se bloquee por IO
    MIN_IO: 2,           // ticks en bloqueado
    MAX_IO: 6,
    TIME_QUANTUM: 3      // quantum en ticks para round-robin
};

// Variables globales
let PID_COUNTER = 1;
let tickCount = 0;
let isRunning = false;
let simulationStartTime = Date.now();
let tickInterval = null;

// Variables para estadísticas
let completedProcesses = 0;
let totalWaitTime = 0;
let totalResponseTime = 0;
let contextSwitches = 0;
let totalProcessesCreated = 0;
let processStartTimes = new Map(); // pid -> start time
let processWaitTimes = new Map(); // pid -> wait time

// Estructuras de datos
let processes = new Map(); // pid -> Process
let readyQueue = []; // pids
let ioQueue = []; // pids blocked by IO
let waitingForMem = []; // pids waiting for memory
let currentRunning = null; // pid running

// Clase Process
class Process {
    constructor(memReq, cpuBurst) {
        this.pid = nextPid();
        this.memReq = memReq;
        this.totalCpu = cpuBurst;
        this.remainingCpu = cpuBurst;
        this.state = 'Nuevo';  // Nuevo -> Listo -> Ejecutando -> Bloqueado -> Terminado
        this.memBlock = null;  // referencia a bloque de memoria asignado
        this.quantumLeft = CONFIG.TIME_QUANTUM;
        this.ioRemaining = 0;
    }

    toString() {
        return `P${this.pid}(${this.state}, mem=${this.memReq}, rem=${this.remainingCpu})`;
    }
}

// Clase MemoryManager (adaptada del código Python)
class MemoryManager {
    constructor(total) {
        // Free list: list of (start, size). We'll keep it sorted by start.
        this.total = total;
        this.free = [[0, total]];
        // Allocations: dict pid -> (start, size)
        this.allocs = new Map();
    }

    firstFitAllocate(pid, size) {
        // Try to allocate 'size' for process pid using first-fit. Returns (start,size) or null.
        for (let idx = 0; idx < this.free.length; idx++) {
            const [start, sz] = this.free[idx];
            if (sz >= size) {
                const allocStart = start;
                this.allocs.set(pid, [allocStart, size]);
                // shrink or remove free block
                if (sz === size) {
                    this.free.splice(idx, 1);
                } else {
                    this.free[idx] = [start + size, sz - size];
                }
                return [allocStart, size];
            }
        }
        return null;
    }
    
    freeAlloc(pid) {
        // Free allocation for pid and merge adjacent free blocks.
        if (!this.allocs.has(pid)) {
            return;
        }
        const freed = this.allocs.get(pid);
        const [start, size] = freed;
        this.allocs.delete(pid);
        // insert and merge
        this.free.push([start, size]);
        this.free.sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const [s, sz] of this.free) {
            if (merged.length === 0) {
                merged.push([s, sz]);
            } else {
                const [lastS, lastSz] = merged[merged.length - 1];
                if (lastS + lastSz === s) {
                    merged[merged.length - 1] = [lastS, lastSz + sz];
                } else {
                    merged.push([s, sz]);
                }
            }
        }
        this.free = merged;
    }

    usedBlocks() {
        // Return list of allocated blocks as (pid,start,size).
        const blocks = [];
        for (const [pid, [start, sz]] of this.allocs) {
            blocks.push([pid, start, sz]);
        }
        return blocks;
    }

    freeSpace() {
        return this.free.reduce((total, [_, sz]) => total + sz, 0);
    }
    
    calculateFragmentation() {
        const totalFree = this.freeSpace();
        if (totalFree === 0) return 0;
        
        const largestFree = Math.max(...this.free.map(([_, sz]) => sz));
        return ((totalFree - largestFree) / totalFree) * 100;
    }

    debug() {
        return `Free: ${JSON.stringify(this.free)} | Allocs: ${JSON.stringify([...this.allocs])}`;
    }
}

// Instancia del gestor de memoria
const memoryManager = new MemoryManager(CONFIG.MEM_TOTAL);

// Funciones auxiliares
function nextPid() {
    return PID_COUNTER++;
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
}

// Funciones de simulación
function tick() {
    tickCount++;
    maybeCreateRandomProcess();

    // Progress IO (blocked)
    for (let i = ioQueue.length - 1; i >= 0; i--) {
        const pid = ioQueue[i];
        const p = processes.get(pid);
        if (!p) {
            ioQueue.splice(i, 1);
            continue;
        }
        p.ioRemaining -= 1;
        if (p.ioRemaining <= 0) {
            ioQueue.splice(i, 1);
            p.state = 'Listo';
            p.quantumLeft = CONFIG.TIME_QUANTUM;
            readyQueue.push(pid);
            log(`P${pid} terminó IO y pasa a Listo.`, 'info');
        }
    }

    // If no running, schedule one
    schedule();

    // Execute one tick for running process
    if (currentRunning !== null) {
        const p = processes.get(currentRunning);
        if (!p) {
            currentRunning = null;
    } else {
            // Simulate possible blocking by IO
            if (Math.random() < CONFIG.IO_PROB) {
                // go to blocked
                p.state = 'Bloqueado';
                p.ioRemaining = randomInt(CONFIG.MIN_IO, CONFIG.MAX_IO);
                ioQueue.push(p.pid);
                log(`P${p.pid} se bloqueó por IO por ${p.ioRemaining} ticks (rem_cpu=${p.remainingCpu}).`, 'warning');
                currentRunning = null;
            } else {
                // execute one tick
                p.remainingCpu -= 1;
                p.quantumLeft -= 1;
                log(`P${p.pid} ejecutando: rem_cpu=${p.remainingCpu}, quantum_left=${p.quantumLeft}`, 'info');
                if (p.remainingCpu <= 0) {
                    // terminates
                    log(`P${p.pid} terminó ejecución.`, 'success');
                    // free memory and awaken waiting
                    freeMemoryAndAwaken(p.pid);
                    currentRunning = null;
                    // Terminar el proceso y actualizar estadísticas
                    terminateProcess(p.pid);
                } else {
                    // quantum expired? if there are other ready processes, preempt
                    if (p.quantumLeft <= 0 && readyQueue.length > 0) {
                        p.state = 'Listo';
                        p.quantumLeft = CONFIG.TIME_QUANTUM;
                        readyQueue.push(p.pid);
                        log(`P${p.pid} fue preempted (quantum agotado). Vuelve a cola Listos.`, 'info');
                        currentRunning = null;
                    } else {
                        // continue running for next tick (if no preemption)
                        // Reset quantum if no other processes waiting
                        if (readyQueue.length === 0) {
                            p.quantumLeft = CONFIG.TIME_QUANTUM;
                        }
                    }
                }
            }
        }
    }

    // Try to allocate memory for waiting processes (in case memory freed by termination)
    for (let i = waitingForMem.length - 1; i >= 0; i--) {
        const wpid = waitingForMem[i];
        const p = processes.get(wpid);
        if (!p) {
            waitingForMem.splice(i, 1);
            continue;
        }
        const alloc = memoryManager.alloc(p.pid, p.memReq);
        if (alloc) {
            waitingForMem.splice(i, 1);
            p.memBlock = alloc;
            p.state = 'Listo';
            readyQueue.push(wpid);
            log(`P${wpid} ahora tiene memoria (start=${alloc[0]}, size=${alloc[1]}) y pasa a Listo (check).`, 'success');
        }
    }

    // update GUI
    updateGUI();
}

function maybeCreateRandomProcess() {
    if (Math.random() < CONFIG.NEW_PROC_PROB) {
    const memReq = randomInt(CONFIG.MIN_PROC_MEM, CONFIG.MAX_PROC_MEM);
    const cpuBurst = randomInt(CONFIG.MIN_CPU_BURST, CONFIG.MAX_CPU_BURST);
        const p = new Process(memReq, cpuBurst);
        p.state = 'Nuevo';
        processes.set(p.pid, p);
        processStartTimes.set(p.pid, tickCount);
        totalProcessesCreated++;
        log(`Generado: P${p.pid} mem=${memReq}, cpu=${cpuBurst}`, 'info');
        tryAllocateAndEnqueue(p);
    }
}

function addRandomProcess() {
    const memReq = randomInt(CONFIG.MIN_PROC_MEM, CONFIG.MAX_PROC_MEM);
    const cpuBurst = randomInt(CONFIG.MIN_CPU_BURST, CONFIG.MAX_CPU_BURST);
    const p = new Process(memReq, cpuBurst);
    p.state = 'Nuevo';
    processes.set(p.pid, p);
    processStartTimes.set(p.pid, tickCount);
    totalProcessesCreated++;
    log(`Proceso creado manualmente: P${p.pid} mem=${memReq}, cpu=${cpuBurst}`, 'info');
    tryAllocateAndEnqueue(p);
}

function tryAllocateAndEnqueue(proc) {
    // try allocate memory
    const alloc = memoryManager.firstFitAllocate(proc.pid, proc.memReq);
    if (alloc) {
        proc.memBlock = alloc;
        proc.state = 'Listo';
        readyQueue.push(proc.pid);
        log(`P${proc.pid} asignado memoria: start=${alloc[0]} size=${alloc[1]}. En cola Listos.`, 'success');
    } else {
        proc.state = 'EsperandoMem';
        waitingForMem.push(proc.pid);
        log(`P${proc.pid} NO tiene memoria suficiente. En espera por memoria.`, 'warning');
    }
}

function freeMemoryAndAwaken(pid) {
    // free memory for pid, and then try to allocate for waiting processes (FIFO)
    memoryManager.freeAlloc(pid);
    log(`P${pid} liberó memoria.`, 'info');
    
    // Try to satisfy waiting_for_mem queue in FIFO order
    const toTry = [...waitingForMem];
    for (const wpid of toTry) {
        if (!processes.has(wpid)) {
            const index = waitingForMem.indexOf(wpid);
            if (index > -1) waitingForMem.splice(index, 1);
            continue;
        }
        const p = processes.get(wpid);
        const alloc = memoryManager.firstFitAllocate(p.pid, p.memReq);
        if (alloc) {
            p.memBlock = alloc;
        p.state = 'Listo';
            const index = waitingForMem.indexOf(wpid);
            if (index > -1) waitingForMem.splice(index, 1);
            readyQueue.push(wpid);
            log(`P${wpid} ahora tiene memoria (start=${alloc[0]}, size=${alloc[1]}) y pasa a Listo.`, 'success');
    } else {
            // Si no hay memoria suficiente, salir del bucle
            break;
        }
    }
}

function schedule() {
    // Preemption / Round-robin
    // If no current running, pick from ready queue
    if (currentRunning === null && readyQueue.length > 0) {
        const pid = readyQueue.shift();
        currentRunning = pid;
        const p = processes.get(pid);
        p.state = 'Ejecutando';
        p.quantumLeft = CONFIG.TIME_QUANTUM;
        log(`P${pid} comienza a ejecutarse (quantum=${CONFIG.TIME_QUANTUM}).`, 'info');
        return;
    }

    // If there is a running process and there are others in ready, enforce quantum
    if (currentRunning !== null) {
        // if there are others ready -> apply time slicing
        const p = processes.get(currentRunning);
        if (readyQueue.length > 0) {
            // quantum logic handled in tick execution
            return;
        } else {
            // if no others ready, allow it to continue without preemption
            p.quantumLeft = CONFIG.TIME_QUANTUM;
        }
    }
}

function processIOQueue() {
    for (let i = ioQueue.length - 1; i >= 0; i--) {
        const pid = ioQueue[i];
        const p = processes.get(pid);
        
        p.ioRemaining--;
        if (p.ioRemaining <= 0) {
            ioQueue.splice(i, 1);
            p.state = 'Listo';
            readyQueue.push(pid);
            log(`Proceso P${pid} completó I/O`, 'info');
        }
    }
}

function processMemoryQueue() {
    for (let i = waitingForMem.length - 1; i >= 0; i--) {
        const pid = waitingForMem[i];
        const p = processes.get(pid);
        
        if (memoryManager.alloc(p.pid, p.memReq)) {
            p.memBlock = true;
            p.state = 'Listo';
            readyQueue.push(pid);
            waitingForMem.splice(i, 1);
            log(`Proceso P${pid} obtuvo memoria: ${p.memReq}KB`, 'success');
        }
    }
}

function executeCurrentProcess() {
    const p = processes.get(currentRunning);
    
    p.remainingCpu--;
    p.quantumLeft--;
    
    // Verificar si el proceso terminó
    if (p.remainingCpu <= 0) {
        terminateProcess(currentRunning);
        return;
    }
    
    // Verificar quantum
    if (p.quantumLeft <= 0) {
        p.quantumLeft = CONFIG.TIME_QUANTUM;
        p.state = 'Listo';
        readyQueue.push(currentRunning);
        currentRunning = null;
        contextSwitches++;
        log(`Proceso P${p.pid} agotó quantum`, 'info');
        return;
    }
    
    // Verificar I/O
    if (Math.random() < CONFIG.IO_PROB) {
        p.ioRemaining = randomInt(CONFIG.MIN_IO, CONFIG.MAX_IO);
        p.state = 'Bloqueado';
        ioQueue.push(currentRunning);
        currentRunning = null;
        contextSwitches++;
        log(`Proceso P${p.pid} bloqueado por I/O`, 'warning');
    }
}

function scheduleNextProcess() {
    if (readyQueue.length > 0) {
        currentRunning = readyQueue.shift();
        const p = processes.get(currentRunning);
        p.state = 'Ejecutando';
        log(`Proceso P${p.pid} ejecutándose`, 'info');
    }
}

function terminateProcess(pid) {
    const p = processes.get(pid);
    
    // Liberar memoria
    if (p.memBlock) {
        memoryManager.freeAlloc(pid);
    }
    
    // Actualizar estadísticas
    completedProcesses++;
    const waitTime = tickCount - processStartTimes.get(pid);
    totalWaitTime += waitTime;
    processWaitTimes.set(pid, waitTime);
    
    // Remover de estructuras
    processes.delete(pid);
    processStartTimes.delete(pid);
    currentRunning = null;
    
    log(`Proceso P${p.pid} terminado`, 'success');
    
    // Intentar satisfacer procesos esperando memoria
    processMemoryQueue();
}

// Funciones de GUI
function updateGUI() {
    console.log('=== updateGUI called ===');
    console.log('Total processes before update:', processes.size);
    
    updateProcessTable();
    updateStatus();
    updateHeaderStats();
    updateStatistics();
    updateMemoryVisualization();
    
    console.log('GUI update completed');
}

function log(message, type = 'info') {
    const logContent = document.getElementById('log-content');
    if (!logContent) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.innerHTML = `<span class="log-time">${timestamp}</span> ${message}`;
    
    logContent.appendChild(logEntry);
    logContent.scrollTop = logContent.scrollHeight;
    
    // Limitar número de logs
    while (logContent.children.length > 50) {
        logContent.removeChild(logContent.firstChild);
    }
}

function updateProcessTable() {
    console.log('=== updateProcessTable called ===');
    updateProcessSummaryCompact();
    updateProcessListCompact();
    // updateProcessTableBody() ya se llama desde updateProcessListCompact()
}

function updateProcessSummaryCompact() {
    // Contar procesos por estado
    let runningCount = 0;
    let readyCount = 0;
    let blockedCount = 0;
    let waitingCount = 0;
    
    for (const [pid, p] of processes) {
        switch (p.state) {
            case 'Ejecutando':
                runningCount++;
                break;
            case 'Listo':
                readyCount++;
                break;
            case 'Bloqueado':
                blockedCount++;
                break;
            case 'EsperandoMem':
                waitingCount++;
                break;
        }
    }
    
    // Actualizar contadores compactos
    const runningEl = document.getElementById('running-count');
    const readyEl = document.getElementById('ready-count');
    const blockedEl = document.getElementById('blocked-count');
    const waitingEl = document.getElementById('waiting-count');
    
    if (runningEl) runningEl.textContent = runningCount;
    if (readyEl) readyEl.textContent = readyCount;
    if (blockedEl) blockedEl.textContent = blockedCount;
    if (waitingEl) waitingEl.textContent = waitingCount;
}

function updateProcessListCompact() {
    console.log('=== updateProcessListCompact called ===');
    // Ahora actualizamos la tabla de procesos en lugar de la lista compacta
    updateProcessTableBody();
}

function updateProcessTableBody() {
    const tbody = document.getElementById('process-table-body');
    console.log('=== updateProcessTableBody called ===');
    console.log('tbody found:', !!tbody);
    console.log('tbody element:', tbody);
    
    if (!tbody) {
        console.log('ERROR: process-table-body element not found!');
        return;
    }
    
    tbody.innerHTML = '';
    console.log('Total processes in Map:', processes.size);
    console.log('Processes Map:', processes);
    
    if (processes.size === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: #ccc; padding: 20px;">
                    No hay procesos activos
                </td>
            </tr>
        `;
        console.log('No processes, showing empty message');
        return;
    }
    
    // Show all processes; order by pid
    const sortedPids = Array.from(processes.keys()).sort((a, b) => a - b);
    console.log('Sorted PIDs:', sortedPids);
    
    for (const pid of sortedPids) {
        const p = processes.get(pid);
        console.log(`Processing PID ${pid}:`, p);
        
        const row = document.createElement('tr');
        
        const stateClass = p.state.toLowerCase().replace(' ', '');
        const quantum = p.quantumLeft || '';
        
        row.innerHTML = `
            <td>P${pid}</td>
            <td><span class="process-state-cell ${stateClass}">${p.state}</span></td>
            <td>${p.memReq}</td>
            <td>${p.remainingCpu}</td>
            <td>${quantum}</td>
        `;
        
        tbody.appendChild(row);
        console.log(`Added row for process P${pid}: ${p.state}, mem: ${p.memReq}, cpu: ${p.remainingCpu}`);
    }
    
    console.log('Process table updated with', sortedPids.length, 'processes');
    console.log('tbody children count:', tbody.children.length);
}



function updateStatus() {
    const statusSummary = document.getElementById('status-summary');
    if (!statusSummary) return;
    
    const running = currentRunning ? 1 : 0;
    const ready = readyQueue.length;
    const io = ioQueue.length;
    const waitmem = waitingForMem.length;
    
    statusSummary.innerHTML = `
        <strong>Resumen del Sistema:</strong><br>
        <strong>Ejecutando:</strong> ${running}<br>
        <strong>Listos:</strong> ${ready}<br>
        <strong>Bloqueados (IO):</strong> ${io}<br>
        <strong>Esperando Memoria:</strong> ${waitmem}<br>
        <strong>Memoria Libre:</strong> ${memoryManager.freeSpace()}/${memoryManager.total}
    `;
}

function updateHeaderStats() {
    // Actualizar contadores del header
    const tickCounter = document.getElementById('tick-counter');
    const processCount = document.getElementById('process-count');
    const memoryUsage = document.getElementById('memory-usage');
    
    if (tickCounter) tickCounter.textContent = tickCount;
    if (processCount) processCount.textContent = processes.size;
    if (memoryUsage) {
        const used = memoryManager.total - memoryManager.freeSpace();
        memoryUsage.textContent = `${used}/${memoryManager.total} KB`;
    }
}

function updateMemoryVisualization() {
    const totalMemory = memoryManager.total;
    const usedMemory = totalMemory - memoryManager.freeSpace();
    const freeMemory = memoryManager.freeSpace();
    const usedPercentage = (usedMemory / totalMemory) * 100;
    const fragmentation = memoryManager.calculateFragmentation();
    
    console.log(`Memory update: Used=${usedMemory}KB, Free=${freeMemory}KB, Percentage=${usedPercentage.toFixed(1)}%`);
    
    // Actualizar displays de memoria del dashboard
    const memoryUsedEl = document.getElementById('memory-used-display');
    const memoryFreeEl = document.getElementById('memory-free-display');
    const memoryUsagePercentEl = document.getElementById('memory-usage-percent');
    const memoryUsageDetailEl = document.getElementById('memory-usage-detail');
    const memoryFragmentationEl = document.getElementById('memory-fragmentation');
    
    if (memoryUsedEl) memoryUsedEl.textContent = `${usedMemory} KB`;
    if (memoryFreeEl) memoryFreeEl.textContent = `${freeMemory} KB`;
    if (memoryUsagePercentEl) memoryUsagePercentEl.textContent = `${Math.round(usedPercentage)}%`;
    if (memoryUsageDetailEl) memoryUsageDetailEl.textContent = `${usedMemory}/${totalMemory} KB`;
    if (memoryFragmentationEl) memoryFragmentationEl.textContent = `${fragmentation.toFixed(1)}%`;
    
    // Actualizar visualización del canvas
    drawMemoryCanvas();
}



function drawMemoryCanvas() {
    const canvas = document.getElementById('memory-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Limpiar canvas
    ctx.clearRect(0, 0, width, height);
    
    // Fondo naranja (estética anterior)
    ctx.fillStyle = 'rgba(255, 152, 0, 0.1)';
    ctx.fillRect(0, 0, width, height);
    
    // Obtener información de memoria
    const totalMemory = memoryManager.total;
    const usedMemory = totalMemory - memoryManager.freeSpace();
    const freeMemory = memoryManager.freeSpace();
    
    // Dibujar memoria como bloques individuales para mayor claridad
    const blockWidth = 20;
    const blockHeight = height - 4;
    const blocksPerRow = Math.floor(width / (blockWidth + 2));
    const totalBlocks = Math.floor(totalMemory / 64); // Asumiendo bloques de 64KB
    const usedBlocks = Math.floor(usedMemory / 64);
    
    let blockIndex = 0;
    let x = 2;
    let y = 2;
    
    // Dibujar bloques usados con PIDs específicos
    let currentMemoryPos = 0;
    const memoryScale = totalMemory / totalBlocks;
    
    for (const [pid, [start, size]] of memoryManager.allocs) {
        const blocksForThisProcess = Math.floor(size / memoryScale);
        
        for (let i = 0; i < blocksForThisProcess && blockIndex < totalBlocks; i++) {
            // Color degradado para bloques usados
            const gradient = ctx.createLinearGradient(x, y, x + blockWidth, y + blockHeight);
            gradient.addColorStop(0, '#9c27b0');
            gradient.addColorStop(1, '#e91e63');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(x, y, blockWidth, blockHeight);
            
            // Borde del bloque
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, blockWidth, blockHeight);
            
            // Texto del proceso si hay espacio
            if (blockWidth > 15) {
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 7px Inter';
                ctx.textAlign = 'center';
                ctx.fillText(`P${pid}`, x + blockWidth/2, y + blockHeight/2 + 2);
            }
            
            x += blockWidth + 2;
            blockIndex++;
            
            // Nueva fila si es necesario
            if (blockIndex % blocksPerRow === 0) {
                x = 2;
                y += blockHeight + 2;
            }
        }
    }
    
    // Dibujar bloques libres
    for (let i = usedBlocks; i < totalBlocks; i++) {
        // Color para bloques libres
        ctx.fillStyle = '#e0e0e0';
        ctx.fillRect(x, y, blockWidth, blockHeight);
        
        // Borde del bloque
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, blockWidth, blockHeight);
        
        // Texto "L" para libre
        if (blockWidth > 10) {
            ctx.fillStyle = '#666666';
            ctx.font = 'bold 7px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('L', x + blockWidth/2, y + blockHeight/2 + 2);
        }
        
        x += blockWidth + 2;
        blockIndex++;
        
        // Nueva fila si es necesario
        if (blockIndex % blocksPerRow === 0) {
            x = 2;
            y += blockHeight + 2;
        }
    }
    
    // Borde del canvas
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, width, height);
}

// Funciones de estadísticas
function updateStatistics() {
    console.log('=== updateStatistics called ===');
    
    // Cálculos de rendimiento
    const cpuUtilization = calculateCPUUtilization();
    const memoryEfficiency = calculateMemoryEfficiency();
    
    console.log('CPU Utilization:', cpuUtilization);
    console.log('Memory Efficiency:', memoryEfficiency);
    console.log('Current Running:', currentRunning);
    console.log('Ready Queue Length:', readyQueue.length);
    const throughput = completedProcesses / Math.max(tickCount, 1);
    const avgResponseTime = totalResponseTime / Math.max(completedProcesses, 1);
    const avgWaitTime = totalWaitTime / Math.max(completedProcesses, 1);
    const successRate = (completedProcesses / Math.max(totalProcessesCreated, 1)) * 100;
    const memoryFragmentation = memoryManager.calculateFragmentation();
    
    // Actualizar elementos de la interfaz del dashboard
    const cpuUtilizationEl = document.getElementById('cpu-utilization');
    const cpuProgressEl = document.getElementById('cpu-progress');
    
    console.log('CPU Utilization Element:', cpuUtilizationEl);
    console.log('CPU Progress Element:', cpuProgressEl);
    
    if (cpuUtilizationEl) {
        cpuUtilizationEl.textContent = cpuUtilization.toFixed(1) + '%';
        console.log('Updated CPU utilization to:', cpuUtilization.toFixed(1) + '%');
    }
    if (cpuProgressEl) {
        cpuProgressEl.style.width = `${cpuUtilization}%`;
        console.log('Updated CPU progress to:', `${cpuUtilization}%`);
    }
    
    const memoryEfficiencyEl = document.getElementById('memory-efficiency');
    if (memoryEfficiencyEl) memoryEfficiencyEl.textContent = memoryEfficiency.toFixed(1) + '%';
    
    const contextSwitchesEl = document.getElementById('context-switches');
    if (contextSwitchesEl) contextSwitchesEl.textContent = contextSwitches;
    
    const throughputEl = document.getElementById('throughput');
    if (throughputEl) throughputEl.textContent = throughput.toFixed(2);
    
    const avgResponseTimeEl = document.getElementById('avg-response-time');
    if (avgResponseTimeEl) avgResponseTimeEl.textContent = avgResponseTime.toFixed(1) + ' ticks';
    
    const completedProcessesEl = document.getElementById('completed-processes');
    if (completedProcessesEl) completedProcessesEl.textContent = completedProcesses;
    
    const successRateEl = document.getElementById('success-rate');
    if (successRateEl) successRateEl.textContent = successRate.toFixed(1) + '%';
    
    // Actualizar valores de configuración
    const autoGenValueEl = document.getElementById('auto-gen-value');
    if (autoGenValueEl) autoGenValueEl.textContent = Math.round(CONFIG.NEW_PROC_PROB * 100) + '%';
    
    const tickSpeedValueEl = document.getElementById('tick-speed-value');
    if (tickSpeedValueEl) tickSpeedValueEl.textContent = CONFIG.TICK_MS + 'ms';
    
    // Actualizar widget de estadísticas
    updateStatsWidget();
}

function calculateCPUUtilization() {
    if (tickCount === 0) return 0;
    
    // Calcular utilización basada en procesos ejecutándose
    let utilization = 0;
    
    // Si hay un proceso ejecutándose, la CPU está siendo utilizada
    if (currentRunning !== null) {
        utilization = 100;
    } else if (readyQueue.length > 0) {
        // Si hay procesos listos pero ninguno ejecutándose, hay algo de utilización
        utilization = 50;
    } else {
        // Si no hay procesos listos ni ejecutándose, la CPU está inactiva
        utilization = 0;
    }
    
    return utilization;
}

function calculateMemoryEfficiency() {
    const used = memoryManager.total - memoryManager.freeSpace();
    return (used / memoryManager.total) * 100;
}

function updateStatsWidget() {
    // Calcular estadísticas
    const totalTime = Math.floor((Date.now() - simulationStartTime) / 1000);
    const completedProcessesCount = completedProcesses;
    const avgTime = completedProcesses > 0 ? Math.round(totalTime / completedProcesses) : 0;
    
    // Actualizar elementos
    const totalTimeEl = document.getElementById('total-time-value');
    const completedProcessesEl = document.getElementById('completed-processes-value');
    const avgTimeEl = document.getElementById('avg-time-value');
    
    if (totalTimeEl) totalTimeEl.textContent = `${totalTime}s`;
    if (completedProcessesEl) completedProcessesEl.textContent = completedProcesses;
    if (avgTimeEl) avgTimeEl.textContent = `${avgTime}s`;
}

function forceUpdateDisplay() {
    console.log('Force updating display...');
    
    // Forzar actualización de memoria
    const totalMemory = memoryManager.total;
    const usedMemory = totalMemory - memoryManager.freeSpace();
    const freeMemory = memoryManager.freeSpace();
    const usedPercentage = (usedMemory / totalMemory) * 100;
    
    console.log(`Memory values: Used=${usedMemory}, Free=${freeMemory}, Percentage=${usedPercentage.toFixed(1)}%`);
    
    // Actualizar elementos de memoria directamente
    const memoryUsagePercentEl = document.getElementById('memory-usage-percent');
    const memoryUsageDetailEl = document.getElementById('memory-usage-detail');
    const memoryUsedEl = document.getElementById('memory-used-display');
    const memoryFreeEl = document.getElementById('memory-free-display');
    
    if (memoryUsagePercentEl) {
        memoryUsagePercentEl.textContent = `${Math.round(usedPercentage)}%`;
        console.log('Updated memory percentage element');
    } else {
        console.log('Memory percentage element not found');
    }
    
    if (memoryUsageDetailEl) {
        memoryUsageDetailEl.textContent = `${usedMemory}/${totalMemory} KB`;
        console.log('Updated memory detail element');
    } else {
        console.log('Memory detail element not found');
    }
    
    if (memoryUsedEl) {
        memoryUsedEl.textContent = `${usedMemory} KB`;
        console.log('Updated memory used element');
    } else {
        console.log('Memory used element not found');
    }
    
    if (memoryFreeEl) {
        memoryFreeEl.textContent = `${freeMemory} KB`;
        console.log('Updated memory free element');
    } else {
        console.log('Memory free element not found');
    }
    
    // Forzar actualización de procesos
    const totalProcessesEl = document.getElementById('total-processes');
    if (totalProcessesEl) {
        totalProcessesEl.textContent = processes.size;
        console.log(`Updated total processes: ${processes.size}`);
    } else {
        console.log('Total processes element not found');
    }
    
    // Actualizar contadores de procesos
    let runningCount = 0, readyCount = 0, blockedCount = 0, waitingCount = 0;
    
    for (const [pid, p] of processes) {
        switch (p.state) {
            case 'Ejecutando': runningCount++; break;
            case 'Listo': readyCount++; break;
            case 'Bloqueado': blockedCount++; break;
            case 'EsperandoMem': waitingCount++; break;
        }
    }
    
    const runningEl = document.getElementById('running-count');
    const readyEl = document.getElementById('ready-count');
    const blockedEl = document.getElementById('blocked-count');
    const waitingEl = document.getElementById('waiting-count');
    
    if (runningEl) runningEl.textContent = runningCount;
    if (readyEl) readyEl.textContent = readyCount;
    if (blockedEl) blockedEl.textContent = blockedCount;
    if (waitingEl) waitingEl.textContent = waitingCount;
    
    console.log(`Process counts: Running=${runningCount}, Ready=${readyCount}, Blocked=${blockedCount}, Waiting=${waitingCount}`);
    
    // Actualizar tabla de procesos
    updateProcessListCompact();
    
    // Actualizar canvas de memoria
    drawMemoryCanvas();
    
    console.log('Force update completed');
}

function toggleStatsView() {
    // Función para expandir estadísticas (similar a toggleProcessView)
    const modal = document.getElementById('stats-modal');
    if (modal) {
        modal.style.display = 'block';
    }
}

// Funciones de control
function toggleSimulation() {
    const startBtn = document.getElementById('start-btn');
    
    if (!isRunning) {
        isRunning = true;
        startBtn.innerHTML = '<i class="fas fa-pause"></i> Pausar';
        log('Simulación iniciada.', 'success');
        
        // Crear algunos procesos iniciales
        createInitialProcesses();
        
        const tickSpeed = parseInt(document.getElementById('tick-speed-modal')?.value || CONFIG.TICK_MS);
        tickInterval = setInterval(tick, tickSpeed);
    } else {
        isRunning = false;
        startBtn.innerHTML = '<i class="fas fa-play"></i> Iniciar';
        log('Simulación pausada.', 'warning');
        if (tickInterval) {
        clearInterval(tickInterval);
            tickInterval = null;
        }
    }
}

function createInitialProcesses() {
    // No crear procesos iniciales - se generarán automáticamente
    log('Simulación iniciada - Los procesos se generarán automáticamente', 'info');
    console.log('Simulation started - Processes will be generated automatically');
    
    // Forzar actualización inmediata de la pantalla
    forceUpdateDisplay();
}

function singleTick() {
    if (!isRunning) {
        tick();
    }
}

function resetSimulation() {
    isRunning = false;
    clearInterval(tickInterval);
    
    const startBtn = document.getElementById('start-btn');
    startBtn.innerHTML = '<i class="fas fa-play"></i> Iniciar';
    
    // Reset variables
    processes.clear();
    readyQueue = [];
    ioQueue = [];
    waitingForMem = [];
    currentRunning = null;
    tickCount = 0;
    completedProcesses = 0;
    totalWaitTime = 0;
    simulationStartTime = Date.now();
    totalResponseTime = 0;
    contextSwitches = 0;
    totalProcessesCreated = 0;
    processStartTimes.clear();
    processWaitTimes.clear();
    PID_COUNTER = 1;
    
    // Reset memory manager
    memoryManager.allocs.clear();
    memoryManager.free = [[0, memoryManager.total]];
    
    // Clear logs
    const logContent = document.getElementById('log-content');
    if (logContent) {
        logContent.innerHTML = '';
    }
    
    // Update GUI
    updateGUI();
    log('Simulación reiniciada - Todo vuelve a cero', 'info');
    console.log('Simulation reset - All variables cleared');
}

function createManualProcess() {
    const memReq = parseInt(document.getElementById('mem-requirement').value);
    const cpuBurst = parseInt(document.getElementById('cpu-burst').value);
    
    if (memReq < CONFIG.MIN_PROC_MEM || memReq > CONFIG.MAX_PROC_MEM) {
        showToast('Memoria debe estar entre 20-300 KB', 'error');
        return;
    }
    
    if (cpuBurst < CONFIG.MIN_CPU_BURST || cpuBurst > CONFIG.MAX_CPU_BURST) {
        showToast('CPU Burst debe estar entre 3-15', 'error');
        return;
    }
    
    const p = new Process(memReq, cpuBurst);
    p.state = 'Nuevo';
    processes.set(p.pid, p);
    processStartTimes.set(p.pid, tickCount);
    totalProcessesCreated++;
    log(`Proceso creado manualmente: P${p.pid} mem=${memReq}, cpu=${cpuBurst}`, 'info');
    tryAllocateAndEnqueue(p);
    
    updateGUI();
}

function clearLogs() {
    const logContent = document.getElementById('log-content');
    if (logContent) {
        logContent.innerHTML = '';
    }
    showToast('Logs limpiados', 'info');
}

// Funciones para toggle de widgets
function toggleProcessView() {
    const modal = document.getElementById('process-modal');
    const btn = document.getElementById('view-toggle-btn');
    
    if (modal.classList.contains('show')) {
        closeProcessModal();
    } else {
        openProcessModal();
    }
}

function openProcessModal() {
    const modal = document.getElementById('process-modal');
    const btn = document.getElementById('view-toggle-btn');
    
    modal.classList.add('show');
    btn.innerHTML = '<i class="fas fa-compress"></i>';
    updateProcessTableBody();
}

function closeProcessModal() {
    const modal = document.getElementById('process-modal');
    const btn = document.getElementById('view-toggle-btn');
    
    modal.classList.remove('show');
    btn.innerHTML = '<i class="fas fa-expand"></i>';
}

function toggleConfigView() {
    const modal = document.getElementById('config-modal');
    const btn = document.getElementById('config-toggle-btn');
    
    if (modal.classList.contains('show')) {
        closeConfigModal();
    } else {
        openConfigModal();
    }
}

function openConfigModal() {
    const modal = document.getElementById('config-modal');
    const btn = document.getElementById('config-toggle-btn');
    
    modal.classList.add('show');
    btn.innerHTML = '<i class="fas fa-compress"></i>';
    
    // Sincronizar valores con los controles principales
    const autoGenProb = document.getElementById('auto-gen-prob').value;
    const tickSpeed = document.getElementById('tick-speed').value;
    
    document.getElementById('auto-gen-prob-modal').value = autoGenProb;
    document.getElementById('tick-speed-modal').value = tickSpeed;
    document.getElementById('auto-gen-value-modal').textContent = Math.round(autoGenProb * 100) + '%';
    document.getElementById('tick-speed-value-modal').textContent = tickSpeed + 'ms';
}

function closeConfigModal() {
    const modal = document.getElementById('config-modal');
    const btn = document.getElementById('config-toggle-btn');
    
    modal.classList.remove('show');
    btn.innerHTML = '<i class="fas fa-expand"></i>';
}

function toggleStatsView() {
    const modal = document.getElementById('stats-modal');
    const btn = document.getElementById('stats-toggle-btn');
    
    if (modal.classList.contains('show')) {
        closeStatsModal();
    } else {
        openStatsModal();
    }
}

function openStatsModal() {
    const modal = document.getElementById('stats-modal');
    const btn = document.getElementById('stats-toggle-btn');
    
    modal.classList.add('show');
    btn.innerHTML = '<i class="fas fa-compress"></i>';
    updateStatistics();
}

function closeStatsModal() {
    const modal = document.getElementById('stats-modal');
    const btn = document.getElementById('stats-toggle-btn');
    
    modal.classList.remove('show');
    btn.innerHTML = '<i class="fas fa-expand"></i>';
}

function toggleLogsView() {
    const modal = document.getElementById('logs-modal');
    const btn = document.getElementById('logs-toggle-btn');
    
    if (modal.classList.contains('show')) {
        closeLogsModal();
    } else {
        openLogsModal();
    }
}

function openLogsModal() {
    const modal = document.getElementById('logs-modal');
    const btn = document.getElementById('logs-toggle-btn');
    
    modal.classList.add('show');
    btn.innerHTML = '<i class="fas fa-compress"></i>';
    
    // Copiar logs al modal
    const logContent = document.getElementById('log-content');
    const logContentModal = document.getElementById('log-content-modal');
    if (logContent && logContentModal) {
        logContentModal.innerHTML = logContent.innerHTML;
    }
}

function closeLogsModal() {
    const modal = document.getElementById('logs-modal');
    const btn = document.getElementById('logs-toggle-btn');
    
    modal.classList.remove('show');
    btn.innerHTML = '<i class="fas fa-expand"></i>';
}



// Función para mostrar notificaciones
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const icon = toast.querySelector('.toast-icon');
    const messageEl = toast.querySelector('.toast-message');
    
    // Set icon based on type
    switch (type) {
        case 'success':
            icon.className = 'toast-icon fas fa-check-circle';
            break;
        case 'error':
            icon.className = 'toast-icon fas fa-exclamation-circle';
            break;
        case 'warning':
            icon.className = 'toast-icon fas fa-exclamation-triangle';
            break;
        default:
            icon.className = 'toast-icon fas fa-info-circle';
    }
    
    messageEl.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}



// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Initialize GUI
    console.log('DOM loaded, initializing GUI...');
    updateGUI();
    
    // Force initial display update
    setTimeout(() => {
        console.log('Forcing initial display update...');
        forceUpdateDisplay();
        
        // Test process table specifically
        console.log('Testing process table update...');
        updateProcessTableBody();
    }, 100);
    
    // Initialize settings
    const autoGenProb = document.getElementById('auto-gen-prob');
    const autoGenValue = document.getElementById('auto-gen-value');
    const tickSpeed = document.getElementById('tick-speed');
    const tickSpeedValue = document.getElementById('tick-speed-value');
    
    autoGenProb.addEventListener('input', function() {
        autoGenValue.textContent = Math.round(this.value * 100) + '%';
        CONFIG.NEW_PROC_PROB = parseFloat(this.value);
    });
    
    tickSpeed.addEventListener('input', function() {
        tickSpeedValue.textContent = this.value + 'ms';
        if (isRunning && tickInterval) {
            clearInterval(tickInterval);
            tickInterval = setInterval(tick, parseInt(this.value));
        }
    });
    
    // Cerrar modales al hacer clic fuera
    document.addEventListener('click', function(event) {
        const processModal = document.getElementById('process-modal');
        const statsModal = document.getElementById('stats-modal');
        const configModal = document.getElementById('config-modal');
        const logsModal = document.getElementById('logs-modal');
        
        if (event.target === processModal) {
            closeProcessModal();
        } else if (event.target === statsModal) {
            closeStatsModal();
        } else if (event.target === configModal) {
            closeConfigModal();
        } else if (event.target === logsModal) {
            closeLogsModal();
        }
    });
    
    // Event listeners para controles del modal de configuración
    const autoGenProbModal = document.getElementById('auto-gen-prob-modal');
    const tickSpeedModal = document.getElementById('tick-speed-modal');
    const quantumModal = document.getElementById('quantum-modal');
    const ioProbModal = document.getElementById('io-prob-modal');
    
    if (autoGenProbModal) {
        autoGenProbModal.addEventListener('input', function() {
            document.getElementById('auto-gen-value-modal').textContent = Math.round(this.value * 100) + '%';
            // Sincronizar con control principal
            document.getElementById('auto-gen-prob').value = this.value;
            document.getElementById('auto-gen-value').textContent = Math.round(this.value * 100) + '%';
            CONFIG.NEW_PROC_PROB = parseFloat(this.value);
        });
    }
    
    if (tickSpeedModal) {
        tickSpeedModal.addEventListener('input', function() {
            document.getElementById('tick-speed-value-modal').textContent = this.value + 'ms';
            // Sincronizar con control principal
            document.getElementById('tick-speed').value = this.value;
            document.getElementById('tick-speed-value').textContent = this.value + 'ms';
            if (isRunning && tickInterval) {
                clearInterval(tickInterval);
                tickInterval = setInterval(tick, parseInt(this.value));
            }
        });
    }
    
    if (quantumModal) {
        quantumModal.addEventListener('input', function() {
            document.getElementById('quantum-value-modal').textContent = this.value;
            CONFIG.TIME_QUANTUM = parseInt(this.value);
        });
    }
    
    if (ioProbModal) {
        ioProbModal.addEventListener('input', function() {
            document.getElementById('io-prob-value-modal').textContent = Math.round(this.value * 100) + '%';
            CONFIG.IO_PROB = parseFloat(this.value);
        });
    }
    
    // Initial GUI update
    updateGUI();
    log('Simulador iniciado. Listo para comenzar.', 'info');
});