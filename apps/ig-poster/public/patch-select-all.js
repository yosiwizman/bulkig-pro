// Patch to add Select All functionality to scheduled posts list
(function() {
    // Wait for DOM to be ready
    function addSelectAllControls() {
        // Find the scheduled posts header
        const scheduledHeader = Array.from(document.querySelectorAll('h3, .muted')).find(el => 
            el.textContent && el.textContent.includes('Scheduled posts')
        );
        
        if (!scheduledHeader) {
            console.log('[Patch] Scheduled posts header not found, retrying...');
            setTimeout(addSelectAllControls, 1000);
            return;
        }
        
        // Find the pagination controls
        const paginationContainer = Array.from(document.querySelectorAll('.row')).find(el => 
            el.textContent && el.textContent.includes('Showing')
        );
        
        if (!paginationContainer) {
            console.log('[Patch] Pagination container not found, retrying...');
            setTimeout(addSelectAllControls, 1000);
            return;
        }
        
        // Check if we already added the controls
        if (document.getElementById('mainSelectAll')) {
            return;
        }
        
        // Create Select All checkbox and Remove Selected button
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'row';
        controlsDiv.style.cssText = 'justify-content: space-between; align-items: center; margin: 8px 0; padding: 8px; background: #0f172a; border-radius: 6px;';
        
        controlsDiv.innerHTML = `
            <label class="row" style="gap: 6px; cursor: pointer;">
                <input id="mainSelectAll" type="checkbox" style="transform: scale(1.2); cursor: pointer;">
                <span style="user-select: none;">Select All</span>
            </label>
            <div class="row" style="gap: 8px; align-items: center;">
                <span class="muted" id="mainSelectedInfo">0 selected</span>
                <button id="mainRemoveSelected" class="secondary" disabled style="padding: 6px 12px;">
                    🗑️ Remove Selected
                </button>
            </div>
        `;
        
        // Insert after the pagination container
        paginationContainer.parentNode.insertBefore(controlsDiv, paginationContainer.nextSibling);
        
        // Track selected items
        const selectedItems = new Set();
        
        // Function to update selected count
        function updateSelectedInfo() {
            const info = document.getElementById('mainSelectedInfo');
            const btn = document.getElementById('mainRemoveSelected');
            if (info) info.textContent = selectedItems.size + ' selected';
            if (btn) btn.disabled = selectedItems.size === 0;
        }
        
        // Add checkboxes to existing items
        function addCheckboxesToItems() {
            const items = document.querySelectorAll('.item');
            items.forEach(item => {
                // Check if checkbox already exists
                if (item.querySelector('.main-select-cb')) return;
                
                // Get the filename from the item
                const filenameEl = item.querySelector('strong');
                if (!filenameEl) return;
                const filename = filenameEl.textContent;
                
                // Create checkbox
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'main-select-cb';
                checkbox.style.cssText = 'margin-right: 12px; transform: scale(1.2); cursor: pointer;';
                
                // Handle checkbox change
                checkbox.addEventListener('change', function() {
                    if (checkbox.checked) {
                        selectedItems.add(filename);
                    } else {
                        selectedItems.delete(filename);
                    }
                    updateSelectedInfo();
                    
                    // Update Select All checkbox state
                    const selectAll = document.getElementById('mainSelectAll');
                    const allCheckboxes = document.querySelectorAll('.main-select-cb');
                    const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);
                    if (selectAll) selectAll.checked = allChecked;
                });
                
                // Insert checkbox at the beginning of the item
                item.insertBefore(checkbox, item.firstChild);
            });
        }
        
        // Add checkboxes to current items
        addCheckboxesToItems();
        
        // Handle Select All
        document.getElementById('mainSelectAll').addEventListener('change', function(e) {
            const checkboxes = document.querySelectorAll('.main-select-cb');
            checkboxes.forEach(cb => {
                cb.checked = e.target.checked;
                cb.dispatchEvent(new Event('change'));
            });
        });
        
        // Handle Remove Selected
        document.getElementById('mainRemoveSelected').addEventListener('click', async function() {
            if (selectedItems.size === 0) return;
            if (!confirm(`Remove ${selectedItems.size} selected items?`)) return;
            
            try {
                // Get the status to find post IDs
                const response = await fetch('/ig/status');
                const data = await response.json();
                const posts = data.next || [];
                
                for (const filename of selectedItems) {
                    const post = posts.find(p => p.filename === filename);
                    if (post && post.id) {
                        await fetch('/ig/posts/' + encodeURIComponent(post.id), { 
                            method: 'DELETE' 
                        });
                    }
                }
                
                selectedItems.clear();
                updateSelectedInfo();
                
                // Reload the page to show updated list
                location.reload();
            } catch (error) {
                alert('Failed to remove items: ' + error.message);
            }
        });
        
        // Watch for DOM changes (pagination)
        const observer = new MutationObserver(() => {
            addCheckboxesToItems();
        });
        
        const listContainer = document.querySelector('#upcoming');
        if (listContainer) {
            observer.observe(listContainer, { childList: true, subtree: true });
        }
        
        console.log('[Patch] Select All controls added successfully');
    }
    
    // Start the patch
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addSelectAllControls);
    } else {
        addSelectAllControls();
    }
})();