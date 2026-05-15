// ================================
//   DAILY NEWS - JAVASCRIPT
// ================================


// ================================
// 1. LIVE DATE IN TOP BAR
// ================================
function setCurrentDate() {
    const dateElement = document.getElementById('currentDate');
    if (dateElement) {
        const now = new Date();
        const options = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };
        dateElement.textContent = now.toLocaleDateString('en-GB', options);
    }
}

setCurrentDate();


// ================================
// 2. ACTIVE NAV LINK HIGHLIGHTER
// ================================
function setActiveNav() {
    const currentPage = window.location.pathname.split('/').pop();
    const navLinks = document.querySelectorAll('.section-nav a');

    navLinks.forEach(link => {
        link.classList.remove('active');
        const linkPage = link.getAttribute('href').split('/').pop();
        if (linkPage === currentPage) {
            link.classList.add('active');
        }
    });
}

setActiveNav();


// ================================
// 3. SMOOTH HOVER ON NEWS CARDS
// ================================
function addCardHovers() {
    const cards = document.querySelectorAll('.news-card, .side-story, .opinion-card');

    cards.forEach(card => {
        card.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';
        card.style.cursor = 'pointer';

        card.addEventListener('mouseenter', () => {
            card.style.transform = 'translateY(-3px)';
            card.style.boxShadow = '0 4px 15px rgba(0,0,0,0.1)';
        });

        card.addEventListener('mouseleave', () => {
            card.style.transform = 'translateY(0)';
            card.style.boxShadow = 'none';
        });

        card.addEventListener('click', () => {
            window.location.href = 'article.html';
        });
    });
}

addCardHovers();


// ================================
// 4. NEWSLETTER SUBSCRIBE BUTTON
// ================================
function setupNewsletter() {
    const subscribeBtn = document.querySelector('.subscribe-btn');
    const emailInput = document.querySelector('.email-input');

    if (subscribeBtn && emailInput) {
        subscribeBtn.addEventListener('click', () => {
            const email = emailInput.value.trim();

            if (email === '') {
                alert('Please enter your email address.');
                return;
            }

            if (!email.includes('@') || !email.includes('.')) {
                alert('Please enter a valid email address.');
                return;
            }

            subscribeBtn.textContent = '✓ Subscribed!';
            subscribeBtn.style.backgroundColor = '#1a5c38';
            emailInput.value = '';

            setTimeout(() => {
                subscribeBtn.textContent = 'Sign up';
                subscribeBtn.style.backgroundColor = '#052962';
            }, 3000);
        });
    }
}

setupNewsletter();


// ================================
// 5. SEARCH BUTTON INTERACTION
// ================================
function setupSearch() {
    const searchBtn = document.querySelector('.search-btn');

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const query = prompt('Search Daily News:');
            if (query && query.trim() !== '') {
                alert(`Searching for: "${query}"\n\nSearch results page coming soon!`);
            }
        });
    }
}

setupSearch();


// ================================
// 6. SUBSCRIBE TOP BUTTON
// ================================
function setupSubscribeTop() {
    const btn = document.querySelector('.subscribe-top-btn');

    if (btn) {
        btn.addEventListener('click', () => {
            const widget = document.querySelector('.newsletter-widget');
            if (widget) {
                widget.scrollIntoView({ behavior: 'smooth' });
                widget.style.outline = '3px solid #c70000';
                setTimeout(() => {
                    widget.style.outline = 'none';
                }, 2000);
            }
        });
    }
}

setupSubscribeTop();


// ================================
// 7. READING PROGRESS BAR
// ================================
function setupProgressBar() {
    const bar = document.createElement('div');
    bar.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        height: 3px;
        width: 0%;
        background-color: #c70000;
        z-index: 9999;
        transition: width 0.1s ease;
    `;
    document.body.appendChild(bar);

    window.addEventListener('scroll', () => {
        const scrollTop = window.scrollY;
        const docHeight = document.body.scrollHeight - window.innerHeight;
        const progress = (scrollTop / docHeight) * 100;
        bar.style.width = progress + '%';
    });
}

setupProgressBar();


// ================================
// 8. BACK TO TOP BUTTON
// ================================
function setupBackToTop() {
    const btn = document.createElement('button');
    btn.textContent = '↑ Top';
    btn.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        background-color: #052962;
        color: #ffffff;
        border: none;
        padding: 10px 16px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        border-radius: 2px;
        display: none;
        z-index: 9998;
        transition: background 0.2s;
    `;

    document.body.appendChild(btn);

    window.addEventListener('scroll', () => {
        if (window.scrollY > 400) {
            btn.style.display = 'block';
        } else {
            btn.style.display = 'none';
        }
    });

    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    btn.addEventListener('mouseenter', () => {
        btn.style.backgroundColor = '#c70000';
    });

    btn.addEventListener('mouseleave', () => {
        btn.style.backgroundColor = '#052962';
    });
}

setupBackToTop();