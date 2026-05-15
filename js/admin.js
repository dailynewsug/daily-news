// ================================
//   DAILY NEWS - ADMIN PANEL
// ================================

import { db, storage, collection, addDoc, getDocs, deleteDoc, doc, updateDoc, orderBy, query, ref, uploadBytes, getDownloadURL } from './firebase.js';

// ================================
// LOAD ALL ARTICLES IN ADMIN
// ================================
async function loadAdminArticles() {
    const list = document.getElementById('adminArticleList');
    if (!list) return;

    list.innerHTML = '<p class="loading-msg">Loading articles...</p>';

    try {
        const q = query(collection(db, 'articles'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            list.innerHTML = '<p class="no-articles">No articles yet. Create your first one above!</p>';
            return;
        }

        list.innerHTML = '';
        snapshot.forEach(docSnap => {
            const a = docSnap.data();
            const id = docSnap.id;

            const card = document.createElement('div');
            card.className = 'admin-article-card';
            card.innerHTML = `
                <div class="admin-card-info">
                    <span class="label ${a.category.toLowerCase()}-label">${a.category}</span>
                    <h3>${a.title}</h3>
                    <div class="admin-card-meta">
                        <span>By ${a.author}</span>
                        <span>${a.date}</span>
                    </div>
                </div>
                <div class="admin-card-actions">
                    <button class="edit-btn" onclick="editArticle('${id}')">Edit</button>
                    <button class="delete-btn" onclick="deleteArticle('${id}')">Delete</button>
                </div>
            `;
            list.appendChild(card);
        });

    } catch (error) {
        list.innerHTML = `<p class="error-msg">Error loading articles: ${error.message}</p>`;
    }
}

// ================================
// PUBLISH ARTICLE
// ================================
async function publishArticle() {
    const title = document.getElementById('artTitle').value.trim();
    const category = document.getElementById('artCategory').value;
    const author = document.getElementById('artAuthor').value.trim();
    const standfirst = document.getElementById('artStandfirst').value.trim();
    const body = document.getElementById('artBody').value.trim();
    const imageFile = document.getElementById('artImage').files[0];
    const editId = document.getElementById('editId').value;

    // VALIDATION
    if (!title || !category || !author || !standfirst || !body) {
        showNotification('Please fill in all required fields.', 'error');
        return;
    }

    const publishBtn = document.getElementById('publishBtn');
    publishBtn.textContent = 'Publishing...';
    publishBtn.disabled = true;

    try {
        let imageUrl = document.getElementById('currentImage').value || '';

        // UPLOAD IMAGE IF PROVIDED
        if (imageFile) {
            const imageRef = ref(storage, `articles/${Date.now()}_${imageFile.name}`);
            await uploadBytes(imageRef, imageFile);
            imageUrl = await getDownloadURL(imageRef);
        }

        const articleData = {
            title,
            category,
            author,
            standfirst,
            body,
            imageUrl,
            date: new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            createdAt: new Date().toISOString()
        };

        if (editId) {
            // UPDATE EXISTING
            await updateDoc(doc(db, 'articles', editId), articleData);
            showNotification('Article updated successfully!', 'success');
        } else {
            // CREATE NEW
            await addDoc(collection(db, 'articles'), articleData);
            showNotification('Article published successfully!', 'success');
        }

        resetForm();
        loadAdminArticles();

    } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
    } finally {
        publishBtn.textContent = 'Publish Article';
        publishBtn.disabled = false;
    }
}

// ================================
// DELETE ARTICLE
// ================================
window.deleteArticle = async function(id) {
    if (!confirm('Are you sure you want to delete this article? This cannot be undone.')) return;

    try {
        await deleteDoc(doc(db, 'articles', id));
        showNotification('Article deleted.', 'success');
        loadAdminArticles();
    } catch (error) {
        showNotification(`Error deleting: ${error.message}`, 'error');
    }
}

// ================================
// EDIT ARTICLE
// ================================
window.editArticle = async function(id) {
    try {
        const snapshot = await getDocs(collection(db, 'articles'));
        snapshot.forEach(docSnap => {
            if (docSnap.id === id) {
                const a = docSnap.data();
                document.getElementById('artTitle').value = a.title;
                document.getElementById('artCategory').value = a.category;
                document.getElementById('artAuthor').value = a.author;
                document.getElementById('artStandfirst').value = a.standfirst;
                document.getElementById('artBody').value = a.body;
                document.getElementById('editId').value = id;
                document.getElementById('currentImage').value = a.imageUrl || '';
                document.getElementById('formTitle').textContent = 'Edit Article';
                document.getElementById('publishBtn').textContent = 'Update Article';

                // Scroll to form
                document.getElementById('articleForm').scrollIntoView({ behavior: 'smooth' });
            }
        });
    } catch (error) {
        showNotification(`Error loading article: ${error.message}`, 'error');
    }
}

// ================================
// RESET FORM
// ================================
function resetForm() {
    document.getElementById('artTitle').value = '';
    document.getElementById('artCategory').value = '';
    document.getElementById('artAuthor').value = '';
    document.getElementById('artStandfirst').value = '';
    document.getElementById('artBody').value = '';
    document.getElementById('artImage').value = '';
    document.getElementById('editId').value = '';
    document.getElementById('currentImage').value = '';
    document.getElementById('formTitle').textContent = 'Write New Article';
    document.getElementById('publishBtn').textContent = 'Publish Article';
}

// ================================
// NOTIFICATION
// ================================
function showNotification(message, type) {
    const existing = document.querySelector('.admin-notification');
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.className = `admin-notification ${type}`;
    notif.textContent = message;
    document.body.appendChild(notif);

    setTimeout(() => notif.remove(), 4000);
}

// ================================
// IMAGE PREVIEW
// ================================
function setupImagePreview() {
    const imageInput = document.getElementById('artImage');
    if (!imageInput) return;

    imageInput.addEventListener('change', () => {
        const file = imageInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = e => {
            let preview = document.getElementById('imagePreview');
            if (!preview) {
                preview = document.createElement('img');
                preview.id = 'imagePreview';
                preview.style.cssText = 'width:100%; max-height:200px; object-fit:cover; margin-top:8px; border:1px solid #dcdcdc;';
                imageInput.parentNode.appendChild(preview);
            }
            preview.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ================================
// INIT
// ================================
document.addEventListener('DOMContentLoaded', () => {
    loadAdminArticles();
    setupImagePreview();

    const publishBtn = document.getElementById('publishBtn');
    if (publishBtn) {
        publishBtn.addEventListener('click', publishArticle);
    }

    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetForm);
    }
});