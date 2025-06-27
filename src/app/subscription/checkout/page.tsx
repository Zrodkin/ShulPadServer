// src/app/subscription/checkout/page.tsx - Redesigned with Real-time Price Validation
'use client'

import React, { useEffect, useState, useRef, Suspense, useCallback } from 'react';

// --- Helper Hooks and Components to replace Next.js functionality ---

const useSearchParams = () => {
  const [params, setParams] = useState(new URLSearchParams());
  useEffect(() => { setParams(new URLSearchParams(window.location.search)); }, []);
  return params;
};

const useRouter = () => {
  return { push: (path: string) => { window.location.href = path; } };
};

const Head = ({ children }: { children: React.ReactNode }) => {
  useEffect(() => {
    const head = document.head;
    const elements: Element[] = [];
    React.Children.forEach(children, child => {
      if (React.isValidElement(child)) {
        const { type, props } = child;
        const tag = type as string;
        const element = document.createElement(tag);
        const elementProps = props as any;
        Object.keys(elementProps).forEach(key => { if(key !== 'children') { const value = elementProps[key]; if(typeof value === 'string') { element.setAttribute(key, value); } } });
        if (elementProps.children && typeof elementProps.children === 'string') { element.textContent = elementProps.children; }
        if (tag === 'script' && elementProps.src === 'https://cdn.tailwindcss.com') { if(!document.querySelector('script[src="https://cdn.tailwindcss.com"]')) { head.appendChild(element); elements.push(element); }
        } else { head.appendChild(element); elements.push(element); }
      }
    });
    return () => { elements.forEach(el => { if(document.head.contains(el)) { document.head.removeChild(el) } }); };
  }, [children]);
  return null;
};

const Script = ({ src, onLoad }: { src: string; onLoad: () => void; strategy?: string }) => {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = src; script.async = true; script.onload = onLoad;
    document.body.appendChild(script);
    return () => { if (document.body.contains(script)) { document.body.removeChild(script); } };
  }, [src, onLoad]);
  return null;
};

// --- UI Helper Components ---
const CheckIcon = () => (<svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>);
const Spinner = ({ size = '8', color = 'blue-600' }) => (<div className={`w-${size} h-${size} animate-spin rounded-full border-4 border-gray-300 border-t-${color}`} />);

// --- Main Page Component ---
declare global { interface Window { Square: any } }

interface ValidatedPriceInfo {
  initialPrice: number;
  discount: number;
  finalPrice: number;
  reason: string;
}

function CheckoutPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const merchantId = searchParams.get('merchant_id');
  const initialPlan = searchParams.get('plan') || 'monthly';
  const initialDevices = parseInt(searchParams.get('devices') || '1');
  const email = searchParams.get('email') || '';
  
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>(initialPlan as 'monthly' | 'yearly');
  const [deviceCount, setDeviceCount] = useState(initialDevices);
  const [customerEmail, setCustomerEmail] = useState(email);
  const [promoCode, setPromoCode] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [squareLoaded, setSquareLoaded] = useState(false);
  
  const [squareConfig, setSquareConfig] = useState<{ application_id: string; location_id: string; } | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  
  const [priceInfo, setPriceInfo] = useState<ValidatedPriceInfo | null>(null);
  const [isVetting, setIsVetting] = useState(true);

  const cardContainerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<any>(null);
  
  // Debounce timer ref - FIXED
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const validatePrice = useCallback(async () => {
    if (!merchantId) return;
    setIsVetting(true);
    try {
      const response = await fetch('/api/subscriptions/validate-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          plan_type: selectedPlan,
          device_count: deviceCount,
          promo_code: promoCode || null,
        }),
      });
      if (response.ok) {
        const data: ValidatedPriceInfo = await response.json();
        setPriceInfo(data);
        setError(null);
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Could not validate price.');
      }
    } catch (err) {
      setError('An network error occurred while validating the price.');
    } finally {
      setIsVetting(false);
    }
  }, [merchantId, selectedPlan, deviceCount, promoCode]);

  useEffect(() => {
    // Validate price on initial load and whenever dependencies change
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      validatePrice();
    }, 500); // 500ms debounce
  }, [validatePrice]);


  useEffect(() => {
    async function fetchSquareConfig() {
      try {
        setConfigLoading(true);
        const response = await fetch('/api/square/subscription-config');
        if (response.ok) setSquareConfig(await response.json());
        else setError(`Failed to load payment configuration`);
      } catch (err) { setError('Failed to load payment configuration.'); } 
      finally { setConfigLoading(false); }
    }
    fetchSquareConfig();
  }, []);
  
  useEffect(() => {
    if (!squareLoaded || !window.Square || !squareConfig || !priceInfo || priceInfo.finalPrice === 0) return;
    const initializeSquare = async () => {
      try {
        const payments = window.Square.payments(squareConfig.application_id, squareConfig.location_id);
        const card = await payments.card({ style: { 'input': { fontSize: '16px' } } });
        if(cardContainerRef.current) await card.attach('#card-container');
        cardRef.current = card;
      } catch (err) { setError('Failed to load payment form.'); }
    }
    initializeSquare();
  }, [squareLoaded, squareConfig, priceInfo]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Determine if payment token is needed
    const needsPayment = priceInfo && priceInfo.finalPrice > 0;
    let sourceId = null;

    if (needsPayment) {
      if (!cardRef.current) {
        setError('Payment form not initialized.');
        setIsLoading(false);
        return;
      }
      try {
        const tokenResult = await cardRef.current.tokenize();
        if (tokenResult.status === 'OK') {
          sourceId = tokenResult.token;
        } else {
          throw new Error(tokenResult.errors?.map((err: any) => err.message).join(', ') || 'Invalid card details.');
        }
      } catch (err: any) {
        setError(err.message);
        setIsLoading(false);
        return;
      }
    }

    // Call the create subscription endpoint
    try {
      const subscriptionResponse = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          plan_type: selectedPlan,
          device_count: deviceCount,
          customer_email: customerEmail || undefined,
          source_id: sourceId, // Will be null for free subscriptions
          promo_code: promoCode || null
        })
      });
      if (!subscriptionResponse.ok) {
        const errorData = await subscriptionResponse.json();
        throw new Error(errorData.error || 'Failed to create subscription');
      }
      const { subscription } = await subscriptionResponse.json();
      router.push(`/subscription/success?merchant_id=${merchantId}&subscription_id=${subscription.id}`);      
    } catch (err: any) {
      setError(err.message);
      setIsLoading(false);
    }
  }
  
  const renderOrderSummary = () => {
    if (isVetting || !priceInfo) {
        return <div className="flex items-center justify-center p-4"><Spinner size="6" /></div>;
    }
    return (
        <div className="mt-6 space-y-4">
            <div className="flex justify-between"><span className="text-slate-600">Base plan ({selectedPlan})</span><span className="font-medium text-slate-800">${priceInfo.initialPrice.toFixed(2)}</span></div>
            {priceInfo.discount > 0 && <div className="flex justify-between text-green-600"><span className="font-medium">Discount</span><span className="font-medium">-${priceInfo.discount.toFixed(2)}</span></div>}
            <div className="flex items-center justify-between pt-4 font-semibold border-t border-slate-200 text-slate-900"><span className="text-lg">Total</span><span className="text-2xl">${priceInfo.finalPrice.toFixed(2)}<span className="text-base font-medium text-slate-500">/{selectedPlan === 'monthly' ? 'mo' : 'yr'}</span></span></div>
        </div>
    );
  }

  if (configLoading) {
    return <div className="flex items-center justify-center min-h-screen bg-slate-50"><div className="text-center"><Spinner size="12" /><p className="mt-4 text-slate-600">Loading checkout...</p></div></div>;
  }
  
  return (
    <>
      <Head><title>ShulPad Subscription</title><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" /><script src="https://cdn.tailwindcss.com"></script></Head>
      <Script src="https://web.squarecdn.com/v1/square.js" onLoad={() => setSquareLoaded(true)} />
      
      <div className="min-h-screen font-sans antialiased bg-slate-50 text-slate-800">
        <form onSubmit={handleSubmit}>
          <div className="container max-w-6xl px-4 py-12 mx-auto lg:py-20">
            <header className="mb-12 text-center">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">ShulPad Pro Subscription</h1>
              <p className="mt-3 text-lg text-slate-600">Complete your secure payment below.</p>
            </header>

            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3 lg:gap-8">
              <main className="lg:col-span-2">
                  <div className="space-y-8">
                    {/* Plan & Device Selection */}
                    <div className="p-8 bg-white border rounded-xl border-slate-200">
                      <h2 className="text-lg font-semibold text-slate-900">1. Customize Your Plan</h2>
                      <div className="grid gap-6 mt-6 sm:grid-cols-2">
                        <div onClick={() => setSelectedPlan('monthly')} className={`relative p-6 rounded-lg cursor-pointer transition-all ${selectedPlan === 'monthly' ? 'ring-2 ring-indigo-600 bg-indigo-50' : 'ring-1 ring-slate-300 hover:ring-indigo-400'}`}>
                          {selectedPlan === 'monthly' && <div className="absolute top-3 right-3 text-indigo-600"><CheckIcon /></div>}
                          <h3 className="text-base font-semibold">Monthly</h3><p className="mt-4 text-2xl font-bold">${49}<span className="text-base font-medium text-slate-500">/mo</span></p>
                        </div>
                        <div onClick={() => setSelectedPlan('yearly')} className={`relative p-6 rounded-lg cursor-pointer transition-all ${selectedPlan === 'yearly' ? 'ring-2 ring-indigo-600 bg-indigo-50' : 'ring-1 ring-slate-300 hover:ring-indigo-400'}`}>
                          <div className="absolute px-2 py-1 text-xs font-semibold tracking-wide text-white uppercase bg-yellow-500 rounded-full -top-3 left-4">Save 17%</div>
                          {selectedPlan === 'yearly' && <div className="absolute top-3 right-3 text-indigo-600"><CheckIcon /></div>}
                          <h3 className="text-base font-semibold">Yearly</h3><p className="mt-4 text-2xl font-bold">${490}<span className="text-base font-medium text-slate-500">/yr</span></p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-6">
                        <span className="text-slate-600">Number of devices</span>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setDeviceCount(Math.max(1, deviceCount - 1))} className="flex items-center justify-center w-8 h-8 font-bold rounded-full text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50" disabled={deviceCount <= 1}>-</button>
                          <span className="w-10 text-lg font-semibold text-center">{deviceCount}</span>
                          <button type="button" onClick={() => setDeviceCount(deviceCount + 1)} className="flex items-center justify-center w-8 h-8 font-bold text-indigo-600 bg-indigo-100 rounded-full hover:bg-indigo-200">+</button>
                        </div>
                      </div>
                    </div>
                    
                    {/* Payment Details or Free Confirmation */}
                    {priceInfo && priceInfo.finalPrice > 0 ? (
                      <div className="p-8 bg-white border rounded-xl border-slate-200">
                        <h2 className="text-lg font-semibold text-slate-900">2. Secure Payment</h2>
                        <div className="mt-4">
                            <label htmlFor="email" className="block text-sm font-medium text-slate-700">Email Address</label>
                            <input id="email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="your@email.com" required className="w-full px-4 py-2 mt-1 text-base bg-white border rounded-md border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                        </div>
                        <div id="card-container" ref={cardContainerRef} className="p-4 mt-4 border rounded-lg min-h-[100px] border-slate-300">
                          {!squareLoaded && (<div className="flex items-center gap-3 text-slate-500"><Spinner size="5" color="slate-500" /><span>Loading payment form...</span></div>)}
                        </div>
                      </div>
                    ) : (
                       <div className="p-8 text-center bg-green-50 border-2 border-dashed rounded-xl border-green-300">
                            <h2 className="text-lg font-semibold text-green-800">Your Subscription is Free!</h2>
                            <p className="mt-2 text-green-700">No payment information is required. Click the button to complete your free activation.</p>
                       </div>
                    )}
                  </div>
              </main>

              <aside className="lg:col-span-1">
                <div className="sticky top-20">
                  <div className="p-8 bg-white border rounded-xl border-slate-200">
                    <h2 className="text-lg font-semibold text-slate-900">Order Summary</h2>
                    {renderOrderSummary()}
                    <div className="mt-8">
                      <label htmlFor="promo-code" className="block text-sm font-medium text-slate-700">Promo Code</label>
                      <input type="text" id="promo-code" value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="Enter code" className="w-full px-3 py-2 mt-1 text-sm bg-white border rounded-md border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                    </div>
                  </div>
                  {error && (<div className="p-4 mt-4 text-sm font-medium text-red-700 bg-red-100 border border-red-200 rounded-lg"><strong>Error:</strong> {error}</div>)}
                  <div className="mt-8">
                    <button type="submit" disabled={isLoading || isVetting} className="flex items-center justify-center w-full px-6 py-4 text-base font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed">
                      {isLoading ? (<><Spinner size="5" color="white" /><span className="ml-3">Processing...</span></>) : 
                       isVetting ? (<><Spinner size="5" color="white" /><span className="ml-3">Verifying price...</span></>) :
                       priceInfo?.finalPrice === 0 ? 'Activate Free Subscription' : `Subscribe for $${priceInfo?.finalPrice.toFixed(2)}`}
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </form>
      </div>
    </>
  )
}

// Main App component
export default function CheckoutPage() {
  return (<Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Spinner size="12" /></div>}><CheckoutPageContent /></Suspense>)
}
