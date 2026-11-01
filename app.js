"use strict";

/*
 * BDMV WEB HOST — HOSPEDEIRO WEB BDMV
 *
 * Port funcional seguro para navegador.
 *
 * Pode carregar, inspecionar, verificar, baixar, armazenar em cache
 * e reproduzir os recursos fornecidos.
 *
 * Não pode executar código nativo de PS4 dentro de um sandbox
 * comum de navegador.
 */

const PAYLOADS = BDMV_ASSETS.payloads;
const PAYLOAD_COUNT = PAYLOADS.length;

/* Índice O(1) por caminho — evita find() a cada clique */
const payloadByPath = new Map();
for (let i = 0; i < PAYLOAD_COUNT; i++) {
    payloadByPath.set(PAYLOADS[i].path, PAYLOADS[i]);
}

/* Cache de elementos DOM (referências estáveis) */
const fileContainer  = document.getElementById("files");
const fileCount      = document.getElementById("fileCount");
const viewer         = document.getElementById("viewer");
const viewerTitle    = document.getElementById("viewerTitle");
const viewerContent  = document.getElementById("viewerContent");
const statusElement  = document.getElementById("status");

/* Cache de elementos de log por id */
const logElements = new Map();
let lastTempLogAt = 0;
const TEMP_LOG_INTERVAL_MS = 100;

let activeRun = 0;
let activeController = null;

/* Progresso agendado via rAF (evita layout thrashing) */
let pendingProgress = null;
let progressRaf = 0;

/* ========================================================
 * INICIALIZAÇÃO
 * ======================================================== */
renderPayloadButtons();
registerServiceWorker();

/* Delegação de eventos: um único listener para todos os botões */
fileContainer.addEventListener("click", function (event) {
    const button = event.target.closest(".item");
    if (!button || !fileContainer.contains(button)) return;
    const path = button.dataset.path;
    if (path) loadResource(path);
});

/* ========================================================
 * BOTÕES DE PAYLOAD
 * ======================================================== */
function renderPayloadButtons() {
    fileCount.textContent = PAYLOAD_COUNT + " ITENS";

    const fragment = document.createDocumentFragment();

    for (let i = 0; i < PAYLOAD_COUNT; i++) {
        const item = PAYLOADS[i];
        const filename = item.path.split("/").pop();

        const button = document.createElement("button");
        button.type = "button";
        button.className = "item";
        button.dataset.path = item.path;

        button.innerHTML =
            '<div class="item-icon">\u25A3</div>' +
            '<div class="item-text">' +
                '<strong>' + escapeHTML(filename) + '</strong>' +
                '<span>' +
                    escapeHTML(item.path) +
                    '&nbsp;&bull;&nbsp;' +
                    escapeHTML(formatBytes(item.bytes)) +
                '</span>' +
            '</div>';

        fragment.appendChild(button);
    }

    fileContainer.appendChild(fragment);
}

/* ========================================================
 * FLUXO SEGURO NO NAVEGADOR (ISO / BDMV)
 * ======================================================== */
async function startIsoWorkflow() {
    const run = ++activeRun;

    if (activeController) activeController.abort();
    const controller = new AbortController();
    activeController = controller;

    viewerTitle.textContent = "FLUXO DE TRABALHO NO NAVEGADOR";

    viewerContent.innerHTML =
        '<video controls autoplay preload="metadata" ' +
            'src="assets/00000.mp4"></video>' +
        '<div class="note">' +
            'Carregando e validando todos os recursos fornecidos.' +
        '</div>' +
        '<div class="meter"><div id="workflowProgress" class="meter-fill"></div></div>' +
        '<div id="workflowProgressLabel" class="progress-label">' +
            '0 / ' + PAYLOAD_COUNT +
        '</div>' +
        '<div id="workflowLog" class="terminal"></div>';

    showViewer();
    setStatus("EXECUTANDO");

    const video = viewerContent.querySelector("video");
    if (video) {
        video.addEventListener("error", function () {
            appendLog("workflowLog",
                "AVISO: o navegador não pôde decodificar 00000.mp4.",
                "warn");
        });
        try {
            await video.play();
        } catch (error) {
            appendLog("workflowLog",
                "A reprodução automática do vídeo foi bloqueada ou atrasada; " +
                "pressione Reproduzir manualmente.",
                "warn");
        }
    }

    appendLog("workflowLog",
        "Iniciando fluxo de trabalho BDMV seguro para navegador.", "ok");

    const verified = await verifyPayloadCollection(
        "workflowLog",
        "workflowProgress",
        "workflowProgressLabel",
        run,
        controller.signal
    );

    if (run !== activeRun) return;
    if (!verified) { setStatus("ERRO"); return; }

    appendLog("workflowLog",
        "Recursos de mídia e payload carregados com sucesso.", "ok");
    appendLog("workflowLog",
        "Sandbox do navegador alcançada. A execução nativa de hen.bin " +
        "não está disponível.", "warn");
    appendLog("workflowLog",
        "Operações privilegiadas BD-J e PS4 exigem o código Xlet " +
        "original e as APIs do console.", "warn");
    appendLog("workflowLog",
        "Fluxo de trabalho do navegador concluído.", "ok");

    setStatus("PRONTO");
}

/* ========================================================
 * MP4
 * ======================================================== */
function loadVideo() {
    viewerTitle.textContent = "00000.MP4";
    viewerContent.innerHTML =
        '<video controls autoplay preload="metadata" ' +
            'src="assets/00000.mp4"></video>' +
        '<div class="download-row">' +
            '<a class="download" href="assets/00000.mp4" download>' +
                'BAIXAR MP4' +
            '</a>' +
        '</div>';
    showViewer();
    setStatus("MÍDIA PRONTA");
}

/* ========================================================
 * STREAM M2TS ORIGINAL
 * ======================================================== */
function loadStream() {
    viewerTitle.textContent = "00000.M2TS";
    viewerContent.innerHTML =
        '<p>Stream de transporte MPEG original da ISO.</p>' +
        '<p class="note">' +
            'A maioria dos navegadores não reproduz M2TS diretamente, ' +
            'então esta ação fornece o arquivo original para download.' +
        '</p>' +
        '<div class="download-row">' +
            '<a class="download" href="assets/00000.m2ts" download>' +
                'BAIXAR STREAM ORIGINAL' +
            '</a>' +
        '</div>';
    showViewer();
    setStatus("STREAM PRONTO");
}

/* ========================================================
 * CARREGAR RECURSO INDIVIDUAL
 * ======================================================== */
async function loadResource(path) {
    const item = payloadByPath.get(path);

    viewerTitle.textContent = path.split("/").pop().toUpperCase();
    viewerContent.innerHTML = '<p id="resourceProgress">Carregando recurso...</p>';
    showViewer();
    setStatus("CARREGANDO");

    try {
        const progressElement = document.getElementById("resourceProgress");

        const bytes = await fetchAsset(path, null, function (loaded, total) {
            if (!progressElement) return;
            if (total > 0) {
                const percent = Math.round((loaded / total) * 100);
                progressElement.textContent =
                    "Carregando recurso... " + percent + "%";
            } else {
                progressElement.textContent =
                    "Carregando recurso... " + formatBytes(loaded);
            }
        });

        const hash = await sha256Hex(bytes.buffer);
        const expectedSize = item ? item.bytes : null;
        const sizeMatches = expectedSize === null || bytes.length === expectedSize;

        viewerContent.innerHTML =
            '<div class="file-info">' +
                '<strong>' + escapeHTML(path) + '</strong>' +
                '<br><br>' +
                'Tamanho: ' + bytes.length.toLocaleString() + ' bytes' +
                (expectedSize !== null
                    ? '<br>Esperado: ' +
                      expectedSize.toLocaleString() + ' bytes'
                    : '') +
                '<br>Verificação de tamanho: ' +
                (sizeMatches
                    ? '<span class="success">OK</span>'
                    : '<span class="danger">FALHOU</span>') +
                '<br>SHA-256: <span class="hash">' +
                escapeHTML(hash) + '</span>' +
            '</div>' +
            '<div class="download-row">' +
                '<a class="download" href="assets/' +
                encodeURI(path) + '" download>' +
                'BAIXAR RECURSO' +
                '</a>' +
            '</div>' +
            '<h3>Pré-visualização binária</h3>' +
            '<pre class="terminal">' + escapeHTML(hexDump(bytes, 256)) + '</pre>';

        setStatus(sizeMatches ? "CARREGADO" : "TAMANHO INCOMPATÍVEL");

    } catch (error) {
        viewerContent.innerHTML =
            '<p>Falha ao carregar recurso.</p>' +
            '<div class="file-info danger">' +
            escapeHTML(error.message) + '</div>';
        setStatus("ERRO");
    }
}

/* ========================================================
 * VERIFICAR TODOS OS PAYLOADS
 * ======================================================== */
async function verifyAll() {
    const run = ++activeRun;

    if (activeController) activeController.abort();
    const controller = new AbortController();
    activeController = controller;

    viewerTitle.textContent = "VERIFICAÇÃO DE PAYLOAD";
    viewerContent.innerHTML =
        '<p class="note">' +
            'Verificando todos os recursos de payload e template esperados.' +
        '</p>' +
        '<div class="meter"><div id="verifyProgress" class="meter-fill"></div></div>' +
        '<div id="verifyProgressLabel" class="progress-label">' +
            '0 / ' + PAYLOAD_COUNT +
        '</div>' +
        '<div id="verifyLog" class="terminal"></div>';

    showViewer();
    setStatus("VERIFICANDO");

    const verified = await verifyPayloadCollection(
        "verifyLog",
        "verifyProgress",
        "verifyProgressLabel",
        run,
        controller.signal
    );

    if (run !== activeRun) return;
    setStatus(verified ? "VERIFICADO" : "ERRO");
}

/* ========================================================
 * ROTINA COMPARTILHADA DE VERIFICAÇÃO
 * ======================================================== */
async function verifyPayloadCollection(logId, progressId, progressLabelId, run, signal) {
    let completed = 0;
    let lastLogAt = 0;

    appendLog(logId, "Verificação iniciada.", "ok");

    for (let index = 0; index < PAYLOAD_COUNT; index++) {
        if (run !== activeRun || signal.aborted) return false;

        const item = PAYLOADS[index];
        appendLog(logId, "CARREGAR " + item.path);

        try {
            const bytes = await fetchAsset(item.path, signal, function (loaded, total) {
                const now = performance.now();
                if (now - lastLogAt < TEMP_LOG_INTERVAL_MS) return;
                lastLogAt = now;

                let message = "  " + formatBytes(loaded);
                if (total > 0) message += " / " + formatBytes(total);
                appendTemporaryLog(logId, message);
            });

            if (bytes.length !== item.bytes) {
                throw new Error(
                    "esperado " + item.bytes + " bytes, recebido " +
                    bytes.length + " bytes"
                );
            }

            const hash = await sha256Hex(bytes.buffer);
            appendLog(logId,
                "OK   " + item.path + " — " +
                bytes.length.toLocaleString() + " bytes — " + hash,
                "ok");

        } catch (error) {
            if (run !== activeRun || signal.aborted) return false;
            appendLog(logId,
                "FALHA " + item.path + " — " + error.message, "bad");
            appendLog(logId, "Verificação falhou.", "bad");
            return false;
        }

        completed++;
        scheduleProgress(progressId, completed, PAYLOAD_COUNT);

        const progressLabel = document.getElementById(progressLabelId);
        if (progressLabel) {
            progressLabel.textContent = completed + " / " + PAYLOAD_COUNT;
        }
    }

    if (run !== activeRun || signal.aborted) return false;
    appendLog(logId,
        "PASSOU — " + PAYLOAD_COUNT + " recursos validados.", "ok");
    return true;
}

/* ========================================================
 * FETCH COM PROGRESSO
 * ======================================================== */
async function fetchAsset(path, signal, onProgress) {
    const response = await fetch("assets/" + path, {
        signal: signal || undefined,
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(response.status + " " + response.statusText);
    }

    const total = Number(response.headers.get("content-length")) || 0;

    if (!response.body || !response.body.getReader) {
        const buffer = await response.arrayBuffer();
        if (onProgress) onProgress(buffer.byteLength, total || buffer.byteLength);
        return new Uint8Array(buffer);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    for (;;) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
        received += result.value.length;
        if (onProgress) onProgress(received, total);
    }

    const bytes = new Uint8Array(received);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
        bytes.set(chunks[i], offset);
        offset += chunks[i].length;
    }
    return bytes;
}

/* ========================================================
 * HASH
 * ======================================================== */
async function sha256Hex(buffer) {
    try {
        if (!globalThis.crypto || !globalThis.crypto.subtle) {
            throw new Error("Web Crypto indisponível");
        }
        const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
        const view = new Uint8Array(digest);
        let out = "";
        for (let i = 0; i < view.length; i++) {
            out += view[i].toString(16).padStart(2, "0");
        }
        return out;
    } catch (error) {
        return "Indisponível — use HTTPS ou http://localhost";
    }
}

/* ========================================================
 * HEX DUMP
 * ======================================================== */
function hexDump(bytes, maximum) {
    const limit = Math.min(bytes.length, maximum || 256);
    const lines = [];

    for (let offset = 0; offset < limit; offset += 16) {
        const end = Math.min(offset + 16, limit);
        const slice = bytes.subarray(offset, end);

        let hex = "";
        for (let i = 0; i < slice.length; i++) {
            hex += slice[i].toString(16).padStart(2, "0");
            if (i < slice.length - 1) hex += " ";
        }
        hex = hex.padEnd(47);

        let text = "";
        for (let i = 0; i < slice.length; i++) {
            const b = slice[i];
            text += (b >= 32 && b <= 126) ? String.fromCharCode(b) : ".";
        }

        lines.push(
            offset.toString(16).padStart(8, "0") +
            "  " + hex + "  |" + text + "|"
        );
    }

    if (bytes.length > limit) {
        lines.push("… " + (bytes.length - limit).toLocaleString() +
                   " bytes restantes");
    }

    return lines.join("\n");
}

/* ========================================================
 * PROGRESSO (agendado via rAF)
 * ======================================================== */
function scheduleProgress(elementId, completed, total) {
    pendingProgress = { elementId, completed, total };
    if (progressRaf) return;
    progressRaf = requestAnimationFrame(function () {
        progressRaf = 0;
        if (!pendingProgress) return;
        const { elementId, completed, total } = pendingProgress;
        pendingProgress = null;
        const element = document.getElementById(elementId);
        if (!element) return;
        const percent = total > 0 ? (completed / total) * 100 : 0;
        element.style.width = percent + "%";
    });
}

/* ========================================================
 * LOG
 * ======================================================== */
function getLogElement(logId) {
    let el = logElements.get(logId);
    if (el && el.isConnected) return el;
    el = document.getElementById(logId);
    if (el) logElements.set(logId, el);
    return el;
}

function appendLog(logId, message, type) {
    const log = getLogElement(logId);
    if (!log) return;

    const temp = log.querySelector(".temporary-log");
    if (temp) temp.remove();

    const line = document.createElement("div");
    line.className = "log-line " + (type || "");
    line.textContent = message;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

function appendTemporaryLog(logId, message) {
    const log = getLogElement(logId);
    if (!log) return;

    let line = log.querySelector(".temporary-log");
    if (!line) {
        line = document.createElement("div");
        line.className = "log-line temporary-log";
        log.appendChild(line);
    }
    line.textContent = message;
    log.scrollTop = log.scrollHeight;
}

/* ========================================================
 * VISUALIZADOR
 * ======================================================== */
function showViewer() {
    viewer.classList.remove("hidden");
    viewer.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeViewer() {
    activeRun++;
    if (activeController) {
        activeController.abort();
        activeController = null;
    }
    viewer.classList.add("hidden");
    viewerContent.innerHTML = "";
    logElements.clear();
    setStatus("PRONTO");
}

/* ========================================================
 * STATUS
 * ======================================================== */
function setStatus(value) {
    statusElement.textContent = value;
}

/* ========================================================
 * SERVICE WORKER
 * ======================================================== */
function registerServiceWorker() {
    if (!("serviceWorker" in navigator) ||
        !/^https?:$/.test(location.protocol)) {
        return;
    }
    navigator.serviceWorker.register("./sw.js").catch(function () {
        /* O aplicativo continua funcionando sem cache offline. */
    });
}

/* ========================================================
 * FORMATAÇÃO DE BYTES
 * ======================================================== */
function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) {
        return "Desconhecido";
    }
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

/* ========================================================
 * ESCAPE HTML
 * ======================================================== */
function escapeHTML(value) {
    const entities = {
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#039;",
    };
    return String(value).replace(/[&<>"']/g, function (c) {
        return entities[c];
    });
}
