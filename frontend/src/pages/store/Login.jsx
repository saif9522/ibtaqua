import { forwardRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, Store } from 'lucide-react';
import { api, errMsg, errFields } from '../../services/api';
import { loggedIn } from '../../redux/store';
import { homeFor } from '../../hooks/useSite';
import { Input, Button, ErrorNote, Field } from '../../components/ui';

/* ---------- Inputs styled like a phone app ---------- */
export const PhoneInput = forwardRef(({ label = 'Mobile number', error, ...p }, ref) => (
  <Field label={label} error={error}>
    {(id) => (
      <div className={`flex overflow-hidden rounded-[var(--radius-ctl)] border bg-white focus-within:ring-3 ${error ? 'border-danger focus-within:ring-danger/15' : 'border-shoal focus-within:border-aqua focus-within:ring-aqua/15'}`}>
        <span className="grid place-items-center border-r border-shoal bg-mist px-3.5 font-semibold text-depth">+91</span>
        <input id={id} ref={ref} inputMode="numeric" maxLength={10} autoComplete="tel-national" placeholder="10-digit mobile number" aria-invalid={!!error}
          className="w-full px-3 py-3 text-[16px] text-ink placeholder:text-ink-soft/60 focus:outline-none" {...p} />
      </div>
    )}
  </Field>
));

export const PasswordInput = forwardRef(({ label = 'Password', error, hint, ...p }, ref) => {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} error={error} hint={hint}>
      {(id) => (
        <div className="relative">
          <input id={id} ref={ref} type={show ? 'text' : 'password'} className={`input py-3 pr-12 text-[16px] ${error ? 'input-error' : ''}`} aria-invalid={!!error} {...p} />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 grid w-12 place-items-center text-ink-soft hover:text-depth">
            {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
      )}
    </Field>
  );
});

const phoneRule = { required: 'Enter your mobile number', pattern: { value: /^[6-9]\d{9}$/, message: 'Enter a valid 10-digit mobile number' } };
const pwRule = { required: 'Choose a password', minLength: { value: 8, message: 'Use at least 8 characters' }, validate: (v) => (/[A-Za-z]/.test(v) && /\d/.test(v)) || 'Use at least one letter and one number' };

export default function Login() {
  const [sp, setSp] = useSearchParams();
  const loc = useLocation();
  const mode = sp.get('mode') || (loc.pathname === '/register' ? 'register' : 'login');
  const setMode = (m) => setSp(m === 'login' ? {} : { mode: m }, { replace: true });
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const done = (data) => { dispatch(loggedIn(data)); navigate(loc.state?.from || homeFor(data.user), { replace: true }); };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-mist/70">
      <div className="mx-auto grid max-w-5xl gap-10 px-4 pb-10 pt-8 lg:grid-cols-2 lg:pt-14">
        <div>
          <h1 className="text-[2.1rem] sm:text-5xl">{mode === 'reset' ? 'Reset password' : 'Log in / Register'}</h1>
          <p className="mt-3 max-w-md text-[16px] text-ink-soft">
            {mode === 'reset' ? "We'll send a code to your mobile so you can set a new password." : 'First time: create your account with OTP and set a password. After that: mobile number + password.'}
          </p>
          <Link to="/partners" className="mt-6 hidden items-center gap-2 rounded-[var(--radius-ctl)] border border-shoal bg-white px-4 py-3 text-sm font-semibold text-depth hover:border-aqua lg:inline-flex"><Store className="size-4 text-aqua" />Shop owner or distributor? Register as a business partner</Link>
        </div>
        <div className="rounded-[22px] bg-white p-5 shadow-[0_8px_30px_rgba(10,74,99,.07)] sm:p-7">
          {mode !== 'reset' && (
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-[14px] bg-mist p-1" role="tablist">
              {[['login', 'Log in'], ['register', 'New account / Register']].map(([m, l]) => (
                <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                  className={`rounded-[11px] px-3 py-3 text-[15px] font-semibold leading-tight transition-colors ${mode === m ? 'bg-white text-depth shadow-sm' : 'text-ink-soft hover:text-depth'}`}>{l}</button>
              ))}
            </div>
          )}
          {mode === 'login' && <LoginForm onDone={done} onForgot={() => setMode('reset')} onRegister={() => setMode('register')} />}
          {mode === 'register' && <OtpFlow purpose="register" onDone={done} onLogin={() => setMode('login')} />}
          {mode === 'reset' && <OtpFlow purpose="reset" onDone={done} onLogin={() => setMode('login')} />}
          <Link to="/partners" className="mt-5 flex items-center justify-center gap-2 text-sm font-semibold text-aqua-700 lg:hidden"><Store className="size-4" />Register your shop as a partner</Link>
        </div>
      </div>
    </div>
  );
}

function LoginForm({ onDone, onForgot, onRegister }) {
  const [err, setErr] = useState(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();
  const submit = async (v) => {
    setErr(null);
    try { onDone((await api.post('/auth/login', { identifier: v.identifier.trim(), password: v.password })).data); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      <PhoneInput error={errors.identifier?.message} {...register('identifier', phoneRule)} />
      <PasswordInput placeholder="The password you set when registering" autoComplete="current-password" error={errors.password?.message} {...register('password', { required: 'Enter your password' })} />
      <div className="text-right"><button type="button" className="text-sm font-semibold text-aqua-700" onClick={onForgot}>Forgot password?</button></div>
      <ErrorNote>{err}</ErrorNote>
      <Button busy={isSubmitting} className="w-full py-3.5 text-[15px]">Log in</Button>
      <p className="text-center text-sm text-ink-soft">New here? <button type="button" className="link" onClick={onRegister}>Create an account</button></p>
    </form>
  );
}

/** Register (OTP → name + password) or Reset (OTP → new password). */
function OtpFlow({ purpose, onDone, onLogin }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [devOtp, setDevOtp] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm();

  const send = async (p) => {
    setErr(null); setBusy(true);
    try { const r = await api.post('/auth/otp/request', { phone: p, purpose }); setPhone(p); setDevOtp(r.data.devOtp || null); setStep('code'); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const finish = async (v) => {
    setErr(null); setBusy(true);
    try {
      const r = purpose === 'register'
        ? await api.post('/auth/otp/verify', { phone, code: v.code, name: v.name, email: v.email || undefined, password: v.password })
        : await api.post('/auth/password/reset', { phone, code: v.code, password: v.password });
      onDone(r.data);
    } catch (e) { Object.entries(errFields(e)).forEach(([k, m]) => setError(k, { message: m })); setErr(errMsg(e)); } finally { setBusy(false); }
  };

  if (step === 'phone') {
    return (
      <form onSubmit={handleSubmit((v) => send(v.phone))} className="space-y-4" noValidate>
        <PhoneInput error={errors.phone?.message} {...register('phone', phoneRule)} />
        <ErrorNote>{err}</ErrorNote>
        <Button busy={busy} className="w-full py-3.5 text-[15px]">Send OTP</Button>
        <p className="text-center text-sm text-ink-soft">{purpose === 'register' ? 'Already have an account?' : 'Remembered it?'} <button type="button" className="link" onClick={onLogin}>Log in</button></p>
      </form>
    );
  }
  return (
    <form onSubmit={handleSubmit(finish)} className="space-y-4" noValidate>
      <p className="text-sm text-ink-soft">Code sent to <b className="text-ink">+91 {phone}</b> · <button type="button" className="link" onClick={() => setStep('phone')}>Change</button></p>
      {devOtp && <p className="rounded-lg bg-marigold-soft px-3 py-2 text-sm text-[#9a6a12]">Development mode: your code is <b>{devOtp}</b></p>}
      <Input label="6-digit OTP" inputMode="numeric" maxLength={6} autoComplete="one-time-code" className="[&_input]:py-3 [&_input]:text-center [&_input]:text-xl [&_input]:tracking-[0.4em]" error={errors.code?.message}
        {...register('code', { required: 'Enter the code', pattern: { value: /^\d{6}$/, message: 'The code has 6 digits' } })} />
      {purpose === 'register' && (
        <>
          <Input label="Your name" autoComplete="name" error={errors.name?.message} {...register('name', { required: 'Enter your name', minLength: { value: 2, message: 'Enter your full name' } })} />
          <Input label="Email (optional, for invoices)" type="email" autoComplete="email" {...register('email')} />
        </>
      )}
      <PasswordInput label={purpose === 'register' ? 'Set a password' : 'New password'} autoComplete="new-password" hint="At least 8 characters with a letter and a number" error={errors.password?.message} {...register('password', pwRule)} />
      <PasswordInput label="Confirm password" autoComplete="new-password" error={errors.confirm?.message} {...register('confirm', { validate: (v) => v === watch('password') || 'Passwords do not match' })} />
      <ErrorNote>{err}</ErrorNote>
      <Button busy={busy} className="w-full py-3.5 text-[15px]">{purpose === 'register' ? 'Create account' : 'Save new password'}</Button>
      <button type="button" className="w-full text-sm text-ink-soft hover:text-aqua-700" onClick={() => send(phone)} disabled={busy}>Didn't get it? Send a new code</button>
    </form>
  );
}
