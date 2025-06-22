'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Script from 'next/script'

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

export default function CheckoutPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  
  // URL parameters
  const orgId = searchParams.get('org_id') || 'default'
  const initialPlan = searchParams.get('plan') || 'monthly'
  const initialDevices = parseInt(searchParams.get('devices') || '1')
  const email = searchParams.get('email') || ''
  
  // State
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>(initialPlan as 'monthly' | 'yearly')
  const [deviceCount, setDeviceCount] = useState(initialDevices)
  const [customerEmail, setCustomerEmail] = useState(email)
  const [promoCode, setPromoCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [squareLoaded, setSquareLoaded] = useState(false)
  
  // Refs
  const cardContainerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<any>(null)
  const paymentsRef = useRef<any>(null)
  
  // Calculate pricing
  const basePrice = PLAN_PRICING[selectedPlan].base
  const extraDevicePrice = (deviceCount - 1) * PLAN_PRICING[selectedPlan].extra
  const totalPrice = basePrice + extraDevicePrice
  
  // Initialize Square Web Payments SDK
  useEffect(() => {
    if (!squareLoaded || !window.Square) return
    
    initializeSquare()
  }, [squareLoaded])
  
  async function initializeSquare() {
    try {
      // Initialize payments
      const payments = window.Square.payments(
        'sq0idp-kt-6g2MHFsJB4J8uT5P-Fw', // Your production Application ID
        'LZ0K8NNRCBAHX' // You'll need to get the location ID from your backend
      )
      paymentsRef.current = payments
      
      // Initialize card payment method
      const card = await payments.card({
        style: {
          '.input-container': {
            borderColor: '#E0E0E0',
            borderRadius: '6px',
          },
          '.input-container.is-focus': {
            borderColor: '#006AFF',
          },
          '.message-text': {
            color: '#999999',
          },
          '.message-icon': {
            color: '#999999',
          },
          '.message-text.is-error': {
            color: '#FF5252',
          },
          '.message-icon.is-error': {
            color: '#FF5252',
          },
        }
      })
      
      await card.attach('#card-container')
      cardRef.current = card
      
    } catch (err) {
      console.error('Failed to initialize Square:', err)
      setError('Failed to load payment form. Please refresh the page.')
    }
  }
  
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    if (!cardRef.current) {
      setError('Payment form not initialized')
      return
    }
    
    if (!customerEmail) {
      setError('Please enter your email address')
      return
    }
    
    setIsLoading(true)
    setError(null)
    
    try {
      // Step 1: Tokenize the card
      const result = await cardRef.current.tokenize()
      
      if (result.status === 'OK') {
        const { token } = result
        
        // Step 2: Create payment method in Square
        const paymentMethodResponse = await fetch('/api/subscription/create-payment-method', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_id: token,
            organization_id: orgId,
            customer_email: customerEmail
          })
        })
        
        if (!paymentMethodResponse.ok) {
          throw new Error('Failed to save payment method')
        }
        
        const { card_id, customer_id } = await paymentMethodResponse.json()
        
        // Step 3: Create subscription
        const subscriptionResponse = await fetch('/api/subscriptions/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organization_id: orgId,
            plan_type: selectedPlan,
            device_count: deviceCount,
            customer_email: customerEmail,
            card_id: card_id,
            promo_code: promoCode || null
          })
        })
        
        if (!subscriptionResponse.ok) {
          const errorData = await subscriptionResponse.json()
          throw new Error(errorData.error || 'Failed to create subscription')
        }
        
        const { subscription } = await subscriptionResponse.json()
        
        // Step 4: Redirect to success page
        router.push(`/subscription/success?org_id=${orgId}&subscription_id=${subscription.id}`)
        
      } else {
        // Handle tokenization errors
        const errors = result.errors || []
        const errorMessage = errors.map((e: any) => e.message).join(', ')
        setError(errorMessage || 'Failed to process payment')
      }
      
    } catch (err: any) {
      console.error('Checkout error:', err)
      setError(err.message || 'An error occurred during checkout')
    } finally {
      setIsLoading(false)
    }
  }
  
  return (
    <>
      <Script 
        src="https://web.squarecdn.com/v1/square.js"
        onLoad={() => setSquareLoaded(true)}
        strategy="afterInteractive"
      />
      
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">ShulPad Subscription</h1>
            <p className="mt-2 text-gray-600">Complete your subscription setup</p>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Plan Selection */}
            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-lg font-semibold mb-4">Select Plan</h2>
              <div className="space-y-3">
                <label className="flex items-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="plan"
                    value="monthly"
                    checked={selectedPlan === 'monthly'}
                    onChange={(e) => setSelectedPlan(e.target.value as 'monthly' | 'yearly')}
                    className="mr-3"
                  />
                  <div className="flex-1">
                    <div className="font-medium">Monthly Plan</div>
                    <div className="text-sm text-gray-600">$49/month for 1 device</div>
                  </div>
                </label>
                
                <label className="flex items-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="plan"
                    value="yearly"
                    checked={selectedPlan === 'yearly'}
                    onChange={(e) => setSelectedPlan(e.target.value as 'monthly' | 'yearly')}
                    className="mr-3"
                  />
                  <div className="flex-1">
                    <div className="font-medium">Yearly Plan</div>
                    <div className="text-sm text-gray-600">$490/year for 1 device (Save 17%)</div>
                  </div>
                </label>
              </div>
            </div>
            
            {/* Device Count */}
            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-lg font-semibold mb-4">Number of Devices</h2>
              <div className="flex items-center space-x-4">
                <button
                  type="button"
                  onClick={() => setDeviceCount(Math.max(1, deviceCount - 1))}
                  className="px-3 py-1 border rounded hover:bg-gray-100"
                >
                  -
                </button>
                <span className="text-lg font-medium w-12 text-center">{deviceCount}</span>
                <button
                  type="button"
                  onClick={() => setDeviceCount(deviceCount + 1)}
                  className="px-3 py-1 border rounded hover:bg-gray-100"
                >
                  +
                </button>
              </div>
              {deviceCount > 1 && (
                <p className="mt-2 text-sm text-gray-600">
                  +${PLAN_PRICING[selectedPlan].extra} per additional device
                </p>
              )}
            </div>
            
            {/* Email */}
            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-lg font-semibold mb-4">Email Address</h2>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            {/* Payment Details */}
            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-lg font-semibold mb-4">Payment Details</h2>
              <div id="card-container" ref={cardContainerRef} className="min-h-[100px]"></div>
            </div>
            
            {/* Promo Code */}
            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-lg font-semibold mb-4">Promo Code (Optional)</h2>
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="Enter promo code"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            {/* Pricing Summary */}
            <div className="bg-blue-50 p-6 rounded-lg">
              <h2 className="text-lg font-semibold mb-2">Order Summary</h2>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Base price ({selectedPlan})</span>
                  <span>${basePrice}</span>
                </div>
                {deviceCount > 1 && (
                  <div className="flex justify-between">
                    <span>{deviceCount - 1} additional device(s)</span>
                    <span>${extraDevicePrice}</span>
                  </div>
                )}
                <div className="border-t pt-2 mt-2 font-semibold flex justify-between">
                  <span>Total</span>
                  <span>${totalPrice}/{selectedPlan === 'monthly' ? 'month' : 'year'}</span>
                </div>
              </div>
            </div>
            
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}
            
            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || !squareLoaded}
              className={`w-full py-3 px-4 rounded-lg font-medium text-white 
                ${isLoading || !squareLoaded 
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              {isLoading ? 'Processing...' : `Subscribe for $${totalPrice}/${selectedPlan === 'monthly' ? 'month' : 'year'}`}
            </button>
            
            {/* Return to App */}
            <div className="text-center">
              <a 
                href={`shulpad://subscription/cancelled?org_id=${orgId}`}
                className="text-blue-600 hover:text-blue-800 text-sm"
              >
                Return to app
              </a>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}