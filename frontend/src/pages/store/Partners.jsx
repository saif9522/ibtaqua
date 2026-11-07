import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useForm } from 'react-hook-form';
import { CheckCircle2 } from 'lucide-react';
import { api, errMsg, errFields } from '../../services/api';
import { loggedIn } from '../../redux/store';
import { Input, Button, ErrorNote, Tabs } from '../../components/ui';

const TYPES = {
  retailer: { label: 'Retailer', who: 'Kirana stores, general stores, cafés and shops', perks: ['Retailer prices on every product', 'Small minimum quantities (from 2 cases)', 'Monthly credit once approved'] },
  wholesaler: { label: 'Wholesaler', who: 'Wholesale traders supplying shops in your market', perks: ['Wholesale prices and quantity discounts', 'Recurring supply on fixed weekdays', 'Credit billing with a running statement'] },
  distributor: { label: 'Distributor', who: 'Area distributors with their own delivery network', perks: ['Distributor price agreements', 'Assigned distribution areas', 'Scheduled bulk supply and credit'] },
};

export default function Partners() {
  const [sp, setSp] = useSearchParams();
  const type = TYPES[sp.get('type')] ? sp.get('type') : 'retailer';
  const t = TYPES[type];
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [err, setErr] = useState(null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({ defaultValues: { state: 'Jharkhand' } });

  const submit = async (v) => {
    setErr(null);
    if (v.password !== v.confirm) return setError('confirm', { message: 'Passwords do not match' });
    try {
      const { confirm, ...body } = v;
      const r = await api.post(`/auth/register/${type}`, body);
      dispatch(loggedIn(r.data));
      navigate('/business/documents', { replace: true });
    } catch (e) {
      Object.entries(errFields(e)).forEach(([k, m]) => setError(k, { message: m }));
      setErr(errMsg(e));
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-4xl sm:text-5xl">Partner with IBT AQUA</h1>
      <p className="mt-3 max-w-2xl text-lg text-ink-soft">Register your business. Our team verifies your GST details, usually within one working day, and your partner prices switch on automatically.</p>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <Tabs tabs={Object.entries(TYPES).map(([value, x]) => ({ value, label: x.label }))} value={type} onChange={(v) => { sp.set('type', v); setSp(sp); }} />
          <p className="font-semibold text-depth">{t.who}</p>
          <ul className="mt-4 space-y-3">{t.perks.map((p) => <li key={p} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-aqua" />{p}</li>)}</ul>
          <ol className="mt-8 space-y-2 border-l-2 border-shoal pl-4 text-sm text-ink-soft">
            <li><b className="text-ink">1. Fill this form.</b> You get an account immediately.</li>
            <li><b className="text-ink">2. Upload documents.</b> GST certificate, PAN or trade licence.</li>
            <li><b className="text-ink">3. Get approved.</b> We notify you, and partner prices go live.</li>
          </ol>
        </div>
        <form onSubmit={handleSubmit(submit)} className="panel grid gap-4 p-6 sm:grid-cols-2 sm:p-8" noValidate>
          <Input className="sm:col-span-2" label="Business name" error={errors.businessName?.message} {...register('businessName', { required: 'Enter your business name' })} />
          <Input label="Contact person" autoComplete="name" error={errors.contactPerson?.message} {...register('contactPerson', { required: 'Enter the contact person' })} />
          <Input label="Mobile number" inputMode="numeric" maxLength={10} error={errors.phone?.message} {...register('phone', { required: 'Enter a mobile number', pattern: { value: /^[6-9]\d{9}$/, message: 'Enter a valid 10-digit mobile' } })} />
          <Input label="Email (optional)" type="email" error={errors.email?.message} {...register('email')} />
          <Input label="GSTIN" placeholder="20ABCDE1234F1Z5" error={errors.gstin?.message} hint={type === 'retailer' ? 'Optional for unregistered shops' : 'Required for GST invoices'} {...register('gstin', type !== 'retailer' ? { required: 'GSTIN is required for this partner type' } : {})} />
          <Input label="PAN (optional)" error={errors.pan?.message} {...register('pan')} />
          <Input className="sm:col-span-2" label="Business address" error={errors.address?.message} {...register('address', { required: 'Enter your business address' })} />
          <Input label="City / town" error={errors.city?.message} {...register('city', { required: 'Enter the city' })} />
          <Input label="Pincode" inputMode="numeric" maxLength={6} error={errors.pincode?.message} {...register('pincode', { required: 'Enter the pincode', pattern: { value: /^\d{6}$/, message: '6 digits' } })} />
          <Input label="State" error={errors.state?.message} {...register('state', { required: true })} />
          <div />
          <Input label="Password" type="password" autoComplete="new-password" hint="At least 8 characters with a letter and a number" error={errors.password?.message} {...register('password', { required: 'Choose a password', minLength: { value: 8, message: 'Use at least 8 characters' } })} />
          <Input label="Confirm password" type="password" autoComplete="new-password" error={errors.confirm?.message} {...register('confirm', { required: 'Repeat the password' })} />
          <div className="sm:col-span-2"><ErrorNote>{err}</ErrorNote></div>
          <Button busy={isSubmitting} className="sm:col-span-2">Register as {t.label.toLowerCase()}</Button>
        </form>
      </div>
    </div>
  );
}
