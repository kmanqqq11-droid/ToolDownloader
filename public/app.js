document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('download-form');
    const urlInput = document.getElementById('url-input');
    const fetchBtn = document.getElementById('fetch-btn');
    const errorMsg = document.getElementById('error-msg');
    const loader = document.getElementById('loader');
    const videoInfo = document.getElementById('video-info');
    const thumbnail = document.getElementById('video-thumbnail');
    const durationBadge = document.getElementById('video-duration');
    const videoTitle = document.getElementById('video-title');
    const formatSelect = document.getElementById('format-select');
    const downloadBtn = document.getElementById('download-btn');

    let currentUrl = '';

    function formatDuration(seconds) {
        if (!seconds) return '';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function formatBytes(bytes, decimals = 2) {
        if (!bytes || bytes === 0) return 'Unknown size';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const url = urlInput.value.trim();
        if (!url) return;

        currentUrl = url;
        
        // Reset UI
        errorMsg.textContent = '';
        videoInfo.classList.add('hidden');
        loader.classList.remove('hidden');
        fetchBtn.disabled = true;

        try {
            const res = await fetch('/api/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to fetch video information');
            }

            // Populate UI
            thumbnail.src = data.thumbnail || '';
            durationBadge.textContent = formatDuration(data.duration);
            videoTitle.textContent = data.title;

            // Populate formats
            formatSelect.innerHTML = '';
            
            if (data.formats.length === 0) {
                throw new Error('No supported formats found for this video.');
            }

            data.formats.forEach(format => {
                const option = document.createElement('option');
                option.value = format.format_id;
                
                let label = `${format.resolution}`;
                if (format.ext) label += ` (${format.ext})`;
                if (format.format_note) label += ` - ${format.format_note}`;
                if (format.filesize) label += ` [${formatBytes(format.filesize)}]`;
                
                // Indicate if it's missing video/audio
                if (!format.vcodec) label += ' 🎵 Audio Only';
                if (!format.acodec && format.vcodec) label += ' 🔇 No Audio';

                option.textContent = label;
                formatSelect.appendChild(option);
            });

            loader.classList.add('hidden');
            videoInfo.classList.remove('hidden');

        } catch (err) {
            errorMsg.textContent = err.message;
            loader.classList.add('hidden');
        } finally {
            fetchBtn.disabled = false;
        }
    });

    downloadBtn.addEventListener('click', () => {
        const selectedFormat = formatSelect.value;
        if (!currentUrl || !selectedFormat) return;

        const downloadUrl = `/api/download?url=${encodeURIComponent(currentUrl)}&format=${encodeURIComponent(selectedFormat)}`;
        
        // Trigger download via hidden link
        const a = document.createElement('a');
        a.href = downloadUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
});
