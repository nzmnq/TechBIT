import React from 'react';

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div>
          <strong style={{ color: '#ffffff' }}>Команда TechBit</strong> — Курсовий проект (2026)
          <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
            Система діагностики гальмівних колодок і ходової за рахунок аналізу вібрації та температури 4 коліс.
          </div>
        </div>

        <div className="social-buttons">
          <a
            href="https://instagram.com"
            target="_blank"
            rel="noreferrer"
            className="social-btn"
            title="Instagram команди TechBit"
          >
            Instagram
          </a>
          <a
            href="https://t.me"
            target="_blank"
            rel="noreferrer"
            className="social-btn"
            title="Telegram канал / контакт TechBit"
          >
            Telegram
          </a>
          <a
            href="https://github.com/nzmnq/TechBIT"
            target="_blank"
            rel="noreferrer"
            className="social-btn"
            title="Репозиторій проекту на GitHub"
          >
            GitHub
          </a>
          <a
            href="mailto:nedovizt26@gmail.com"
            className="social-btn"
            title="Написати на пошту команди TechBIT"
          >
            Email
          </a>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
