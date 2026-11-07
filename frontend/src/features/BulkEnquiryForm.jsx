import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api, errMsg, errFields } from '../services/api';
import { useAuth } from '../hooks/useSite';

/** type: bulk | contact | partnership */
export default function BulkEnquiryForm({ type = 'bulk', dark }) {
  const { user } = useAuth();
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({ defaultValues: { name: user?.name || '', phone: user?.phone || '' } });
  const submit = async (v) => {
    setErr(null);
    try {
      const details = type === 'bulk' ? { quantity: v.quantity, date: v.date, product: v.product } : undefined;
      const r = await api.post('/enquiries', { type, name: v.name, phone: v.phone, email: v.email, businessName: v.businessName, message: v.message, details });
      setDone(r.data.message);
    } catch (e) {
      Object.entries(errFields(e)).forEach(([k, m]) => setError(k, { message: m }));
      setErr(errMsg(e));
    }
  };
  const cls = dark ? 'input border-white/20 bg-white/10 text-white placeholder:text-white/50 focus:border-white' : 'input';
  const lab = dark ? 'mb-1 block text-[13px] font-semibold text-white' : 'label';
  if (done) return <p className={`rounded-[var(--radius-ctl)] p-4 ${dark ? 'bg-white/10 text-white' : 'bg-ok-soft text-ok'}`} role="status">{done}</p>;
  return (
    <form onSubmit={handleSubmit(submit)} className="grid gap-3 sm:grid-cols-2" noValidate>
      <div><label className={lab} htmlFor={`${type}-name`}>Your name</label><input id={`${type}-name`} className={cls} {...register('name', { required: 'Enter your name' })} />{errors.name && <p className="mt-1 text-[13px] text-[#ffb4b4]">{errors.name.message}</p>}</div>
      <div><label className={lab} htmlFor={`${type}-phone`}>Mobile number</label><input id={`${type}-phone`} className={cls} inputMode="numeric" maxLength={10} {...register('phone', { required: 'Enter your mobile number', pattern: { value: /^[6-9]\d{9}$/, message: 'Enter a 10-digit mobile number' } })} />{errors.phone && <p className={`mt-1 text-[13px] ${dark ? 'text-[#ffb4b4]' : 'text-danger'}`}>{errors.phone.message}</p>}</div>
      {type === 'bulk' && (
        <>
          <div><label className={lab} htmlFor="b-qty">How much water?</label><input id="b-qty" className={cls} placeholder="e.g. 200 cases of 500 ml" {...register('quantity')} /></div>
          <div><label className={lab} htmlFor="b-date">Needed by</label><input id="b-date" type="date" className={cls} {...register('date')} /></div>
        </>
      )}
      {type !== 'bulk' && <div className="sm:col-span-2"><label className={lab} htmlFor={`${type}-email`}>Email (optional)</label><input id={`${type}-email`} type="email" className={cls} {...register('email')} /></div>}
      <div className="sm:col-span-2"><label className={lab} htmlFor={`${type}-msg`}>{type === 'bulk' ? 'Anything else we should know?' : 'Message'}</label><textarea id={`${type}-msg`} rows={3} className={cls} {...register('message', type === 'contact' ? { required: 'Write your message' } : {})} />{errors.message && <p className="mt-1 text-[13px] text-danger">{errors.message.message}</p>}</div>
      {err && <p className={`sm:col-span-2 text-sm ${dark ? 'text-[#ffb4b4]' : 'text-danger'}`}>{err}</p>}
      <div className="sm:col-span-2"><button className={dark ? 'btn bg-white text-depth hover:bg-mist' : 'btn-primary'} disabled={isSubmitting}>{type === 'bulk' ? 'Request a quote' : 'Send message'}</button></div>
    </form>
  );
}
