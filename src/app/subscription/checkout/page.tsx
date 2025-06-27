// src/app/subscription/checkout/page.tsx - Redesigned & Fixed
import React, { useEffect, useState, useRef, Suspense } from 'react';

// --- Helper Hooks to replace Next.js functionality ---

// Replaces Next.js's useSearchParams
const useSearchParams = () => {
  const [params, setParams] = useState(new URLSearchParams());

  useEffect(() => {
    // Ensure this runs only on the client side
    setParams(new URLSearchParams(window.location.search));
  }, []);

  return params;
};

// Replaces Next.js's useRouter
const useRouter = () => {
  return {
    push: (path: string) => {
      // Ensure this runs only on the client side
      window.location.href = path;
    },
  };
};

// Replaces Next.js's Head component
const Head = ({ children }: { children: React.ReactNode }) => {
  useEffect(() => {
    const titleElement = React.Children.toArray(children).find(
      (child) =>
        React.isValidElement(child) &&
        child.type === 'title'
    );

    // Type guard to ensure titleElement is a valid React element with the expected props.
    if (
      React.isValidElement(titleElement) &&
      titleElement.props &&
      typeof (titleElement.props as any).children === 'string'
    ) {
      document.title = (titleElement.props as any).children;
    }
  }, [children]);

  return null;
};

// Replaces Next.js's Script component
const Script = ({ src, onLoad, strategy }: { src: string; onLoad: () => void; strategy?: string }) => {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = onLoad;

    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, [src, onLoad]);

  return null;
};


// --- UI Helper Components ---

const CheckIcon = () => (
  <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
  </svg>
);

const Spinner = ({ size = '8', color = 'blue-600' }) => (
  <div className={`w-${size} h-${size} animate-spin rounded-full border-4 border-gray-300 border-t-${color}`} />
);

// --- Main Page Component ---

declare global {
  interface Window {
    Square: any
  }
}

interface PlanPricing {
  monthly: { base: number; extra: number }
  yearly: { base: number; extra: number }
}

const PLAN_PRICING: PlanPricing = {
  monthly: { base: 49, extra: 15 },
  yearly: { base: 490, extra: 150 }
}

function CheckoutPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  
  // URL parameters
  const merchantId = searchParams.get('merchant_id');
  const initialPlan = searchParams.get('plan') || 'monthly';
  const initialDevices = parseInt(searchParams.get('devices') || '1');
  const email = searchParams.get('email') || '';
  
  // State
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>(initialPlan as 'monthly' | 'yearly');
  const [deviceCount, setDeviceCount] = useState(initialDevices);
  const [customerEmail, setCustomerEmail] = useState(email);
  const [promoCode, setPromoCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [squareLoaded, setSquareLoaded] = useState(false);
  
  // SECURE: Square config state
  const [squareConfig, setSquareConfig] = useState<{
    application_id: string
    location_id: string
  } | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [merchantEmail, setMerchantEmail] = useState('');
  const [emailSource, setEmailSource] = useState('');
  
  // Refs
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<any>(null);
  const paymentsRef = useRef<any>(null);
  
  // Calculate pricing
  const basePrice = PLAN_PRICING[selectedPlan].base;
  const extraDevicePrice = (deviceCount > 1) ? (deviceCount - 1) * PLAN_PRICING[selectedPlan].extra : 0;
  const totalPrice = basePrice + extraDevicePrice;
  
  // SECURE: Fetch Square config from backend
  useEffect(() => {
    async function fetchSquareConfig() {
      try {
        setConfigLoading(true);
        const response = await fetch('/api/square/subscription-config');
        
        if (response.ok) {
          const config = await response.json();
          setSquareConfig(config);
        } else {
          const errorData = await response.json();
          setError(`Failed to load payment configuration: ${errorData.error || 'Unknown error'}`);
        }
      } catch (err) {
        console.error('Config fetch error:', err);
        setError('Failed to load payment configuration. Please refresh the page.');
      } finally {
        setConfigLoading(false);
      }
    }
    
    fetchSquareConfig();
  }, []);
  
  // SECURE: Initialize Square with fetched config
  useEffect(() => {
    if (!squareLoaded || !window.Square || !squareConfig) return;
    
    const initializeSquare = async () => {
      if (!squareConfig) {
        setError('Square configuration not loaded');
        return;
      }
      try {
        const payments = window.Square.payments(squareConfig.application_id, squareConfig.location_id);
        paymentsRef.current = payments;
        
        const card = await payments.card({
          style: { 'input': { fontSize: '16px' } }
        });
        
        if(cardContainerRef.current) {
          await card.attach('#card-container');
        }
        cardRef.current = card;

      } catch (err) {
        console.error('Failed to initialize Square:', err);
        setError('Failed to load payment form. Please refresh the page.');
      }
    }

    initializeSquare();
  }, [squareLoaded, squareConfig]);

  // Fetch Merchant Email
  useEffect(() => {
    if (!merchantId) return;

    fetch(`/api/subscriptions/merchant-email?merchant_id=${merchantId}`)
      .then(res => res.json())
      .then(data => {
        if (data.merchant_email) {
          setMerchantEmail(data.merchant_email);
          setCustomerEmail(data.merchant_email); // Auto-fill
          setEmailSource('merchant');
        }
      })
      .catch(error => {
        console.warn("Could not fetch merchant email:", error);
      });
  }, [merchantId]);
  
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!cardRef.current) {
      setError('Payment form not initialized');
      return;
    }
    
    if (!customerEmail) {
      setError('Email address is required');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const verificationDetails = {
        amount: String(totalPrice.toFixed(2)),
        currencyCode: 'USD',  
        billingContact: { email: customerEmail },
        intent: 'CHARGE',
      };
      
      const tokenResult = await cardRef.current.tokenize(verificationDetails);
      
      if (tokenResult.status === 'OK') {
        const { token } = tokenResult;
        
        const subscriptionResponse = await fetch('/api/subscriptions/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchant_id: merchantId,
            plan_type: selectedPlan,
            device_count: deviceCount,
            customer_email: customerEmail || undefined,
            source_id: token,
            promo_code: promoCode || null
          })
        });
        
        if (!subscriptionResponse.ok) {
          const errorData = await subscriptionResponse.json();
          throw new Error(errorData.error || 'Failed to create subscription');
        }
        
        const { subscription } = await subscriptionResponse.json();
        router.push(`/subscription/success?merchant_id=${merchantId}&subscription_id=${subscription.id}`);      
      } else {
        const errorMessage = tokenResult.errors?.map((e: any) => e.message).join(', ') || 'Failed to process payment information';
        setError(errorMessage);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during checkout');
    } finally {
      setIsLoading(false);
    }
  }
  
  // Loading and Error States
  if (configLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <Spinner size="12" />
          <p className="mt-4 text-slate-600">Loading payment configuration...</p>
        </div>
      </div>
    );
  }
  
  if (!squareConfig) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4 bg-slate-50">
        <div className="w-full max-w-md p-8 text-center bg-white border border-red-200 rounded-lg shadow-md">
            <h1 className="text-xl font-bold text-red-800">Configuration Error</h1>
            <p className="mt-2 text-red-600">{error || 'Failed to load payment configuration'}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 mt-6 text-sm font-semibold text-white bg-red-600 rounded-md hover:bg-red-700"
            >
              Retry
            </button>
        </div>
      </div>
    );
  }
  
  return (
    <>
      <Head>
        <title>ShulPad Subscription</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      </Head>
      
      <Script 
        src="https://web.squarecdn.com/v1/square.js"
        onLoad={() => setSquareLoaded(true)}
      />
      
      <div className="min-h-screen font-sans antialiased bg-slate-50 text-slate-800">
        <div className="container max-w-6xl px-4 py-12 mx-auto lg:py-20">

          <header className="mb-12 text-center">
             <a href="#" className="inline-flex items-center justify-center w-16 h-16 mx-auto mb-6 bg-indigo-100 rounded-2xl">
                <svg className="w-8 h-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9.563C9 9.252 9.252 9 9.563 9h4.874c.311 0 .563.252.563.563v4.874c0 .311-.252.563-.563.563H9.563C9.252 15 9 14.748 9 14.437V9.563z" />
                </svg>
            </a>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">ShulPad Pro Subscription</h1>
            <p className="mt-3 text-lg text-slate-600">Complete your secure payment below.</p>
          </header>

          <div className="grid grid-cols-1 gap-12 lg:grid-cols-3 lg:gap-8">
            <main className="lg:col-span-2">
              <form onSubmit={handleSubmit}>
                <div className="space-y-8">
                  <div className="p-8 bg-white border rounded-xl border-slate-200">
                    <h2 className="text-lg font-semibold text-slate-900">1. Choose Your Plan</h2>
                    <div className="grid gap-6 mt-6 sm:grid-cols-2">
                      <div onClick={() => setSelectedPlan('monthly')} className={`relative p-6 rounded-lg cursor-pointer transition-all duration-200 ${selectedPlan === 'monthly' ? 'ring-2 ring-indigo-600 bg-indigo-50' : 'ring-1 ring-slate-300 hover:ring-indigo-400'}`}>
                        {selectedPlan === 'monthly' && <div className="absolute top-3 right-3 text-indigo-600"><CheckIcon /></div>}
                        <h3 className="text-base font-semibold">Monthly Plan</h3>
                        <p className="mt-1 text-sm text-slate-600">Pay as you go.</p>
                        <p className="mt-4 text-2xl font-bold text-slate-900">${PLAN_PRICING.monthly.base}<span className="text-base font-medium text-slate-500">/mo</span></p>
                      </div>
                      <div onClick={() => setSelectedPlan('yearly')} className={`relative p-6 rounded-lg cursor-pointer transition-all duration-200 ${selectedPlan === 'yearly' ? 'ring-2 ring-indigo-600 bg-indigo-50' : 'ring-1 ring-slate-300 hover:ring-indigo-400'}`}>
                        <div className="absolute px-2 py-1 text-xs font-semibold tracking-wide text-white uppercase bg-yellow-500 rounded-full -top-3 left-4">Save 17%</div>
                        {selectedPlan === 'yearly' && <div className="absolute top-3 right-3 text-indigo-600"><CheckIcon /></div>}
                        <h3 className="text-base font-semibold">Yearly Plan</h3>
                        <p className="mt-1 text-sm text-slate-600">Best value for your organization.</p>
                        <p className="mt-4 text-2xl font-bold text-slate-900">${PLAN_PRICING.yearly.base}<span className="text-base font-medium text-slate-500">/yr</span></p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-8 sm:grid-cols-2">
                    <div className="p-8 bg-white border rounded-xl border-slate-200">
                      <h2 className="text-lg font-semibold text-slate-900">2. Select Devices</h2>
                       <div className="flex items-center justify-between mt-6">
                          <span className="text-slate-600">Number of devices</span>
                          <div className="flex items-center gap-2">
                              <button type="button" onClick={() => setDeviceCount(Math.max(1, deviceCount - 1))} className="flex items-center justify-center w-8 h-8 font-bold rounded-full text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50" disabled={deviceCount <= 1}>-</button>
                              <span className="w-10 text-lg font-semibold text-center">{deviceCount}</span>
                              <button type="button" onClick={() => setDeviceCount(deviceCount + 1)} className="flex items-center justify-center w-8 h-8 font-bold text-indigo-600 bg-indigo-100 rounded-full hover:bg-indigo-200">+</button>
                          </div>
                      </div>
                      {deviceCount > 1 && <p className="mt-3 text-sm text-right text-slate-500">+${PLAN_PRICING[selectedPlan].extra} for each additional device</p>}
                    </div>

                    <div className="p-8 bg-white border rounded-xl border-slate-200">
                      <h2 className="text-lg font-semibold text-slate-900">3. Email Address</h2>
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => {
                          setCustomerEmail(e.target.value)
                          setEmailSource(e.target.value === merchantEmail ? 'merchant' : 'custom')
                        }}
                        placeholder={merchantEmail || "charity@example.org"}
                        required={!merchantEmail}
                        className="w-full px-4 py-2 mt-6 text-base bg-white border rounded-md border-slate-300 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      {merchantEmail && emailSource === 'merchant' && (
                        <p className="mt-2 text-xs text-green-600">Using your Square account email.</p>
                      )}
                    </div>
                  </div>

                  <div className="p-8 bg-white border rounded-xl border-slate-200">
                    <h2 className="text-lg font-semibold text-slate-900">4. Secure Payment</h2>
                    <div id="card-container" ref={cardContainerRef} className="p-4 mt-6 border rounded-lg min-h-[100px] border-slate-300">
                      {!squareLoaded && (
                        <div className="flex items-center gap-3 text-slate-500">
                           <Spinner size="5" color="slate-500" />
                           <span>Loading payment form...</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </form>
            </main>

            <aside className="lg:col-span-1">
              <div className="sticky top-20">
                <div className="p-8 bg-white border rounded-xl border-slate-200">
                  <h2 className="text-lg font-semibold text-slate-900">Order Summary</h2>
                  
                  <div className="mt-6 space-y-4">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Base plan ({selectedPlan})</span>
                      <span className="font-medium text-slate-800">${basePrice}</span>
                    </div>

                    {deviceCount > 1 && (
                      <div className="flex justify-between pb-4 border-b border-slate-200">
                         <span className="text-slate-600">{deviceCount - 1} additional device{deviceCount > 2 ? 's' : ''}</span>
                        <span className="font-medium text-slate-800">${extraDevicePrice}</span>
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between pt-4 font-semibold text-slate-900">
                      <span className="text-lg">Total</span>
                       <span className="text-2xl">${totalPrice}<span className="text-base font-medium text-slate-500">/{selectedPlan === 'monthly' ? 'mo' : 'yr'}</span></span>
                    </div>
                  </div>

                   <div className="mt-8">
                     <label htmlFor="promo-code" className="block text-sm font-medium text-slate-700">Promo Code</label>
                      <input
                          type="text"
                          id="promo-code"
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value)}
                          placeholder="Enter code"
                          className="w-full px-3 py-2 mt-1 text-sm bg-white border rounded-md border-slate-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                  </div>
                </div>

                {error && (
                  <div className="p-4 mt-4 text-sm font-medium text-red-700 bg-red-100 border border-red-200 rounded-lg">
                    <strong>Error:</strong> {error}
                  </div>
                )}
                
                <div className="mt-8">
                  <button
                    type="submit"
                    onClick={handleSubmit} 
                    disabled={isLoading || !squareLoaded || !squareConfig}
                    className="flex items-center justify-center w-full px-6 py-4 text-base font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <>
                        <Spinner size="5" color="white" />
                        <span className="ml-3">Processing...</span>
                      </>
                    ) : (
                      `Subscribe for $${totalPrice}/${selectedPlan === 'monthly' ? 'mo' : 'yr'}`
                    )}
                  </button>
                </div>
                
                 <div className="mt-6 text-center">
                  <a href={`shulpad://subscription/cancelled?merchant_id=${merchantId}`} className="text-sm font-medium text-slate-600 hover:text-indigo-600">
                    ← Return to ShulPad
                  </a>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </>
  )
}

// Main App component
function App() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
           <Spinner size="12" />
           <p className="mt-4 text-slate-600">Loading checkout...</p>
        </div>
      </div>
    }>
      <CheckoutPageContent />
    </Suspense>
  )
}

export default App;
