import { useOutletContext } from 'react-router-dom';

export default function SSLManagerDashboard() {
  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  const t = {
    en: {
      title: 'SSL Certificate Manager',
      desc: 'Generate and manage Let\'s Encrypt certificates automatically with Certbot.'
    },
    vi: {
      title: 'Quản lý Chứng chỉ SSL',
      desc: 'Tự động tạo mới và quản lý chứng chỉ Let\'s Encrypt với Certbot.'
    }
  };
  const tr = t[language || 'en'];

  return (
    <div className={`p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'
      }`}>
        <div className="space-y-2 max-w-2xl text-center md:text-left">
          <h2 className={`text-2xl md:text-3xl font-extrabold tracking-tight ${
            isDark ? 'bg-gradient-to-r from-teal-400 via-emerald-200 to-white bg-clip-text text-transparent' : 'bg-gradient-to-r from-teal-600 via-emerald-600 to-slate-800 bg-clip-text text-transparent'
          }`}>
            {tr.title}
          </h2>
          <p className={`text-xs md:text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {tr.desc}
          </p>
        </div>
      </div>
    </div>
  );
}
