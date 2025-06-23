// src/app/subscription/checkout/page.tsx - FIXED VERSION
'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Script from 'next/script'
import Head from 'next/head'

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
  
  // 🔒 SECURE: Square config state
  const [squareConfig, setSquareConfig] = useState<{
    application_id: string
    location_id: string
  } | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  
  // Refs
  const cardContainerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<any>(null)
  const paymentsRef = useRef<any>(null)
  
  // Calculate pricing
  const basePrice = PLAN_PRICING[selectedPlan].base
  const extraDevicePrice = (deviceCount - 1) * PLAN_PRICING[selectedPlan].extra
 const totalPrice = 1 // ✅ TEMPORARY: $1 for testing
  
  // 🔒 SECURE: Fetch Square config from backend
  useEffect(() => {
    async function fetchSquareConfig() {
      try {
        setConfigLoading(true)
        const response = await fetch('/api/square/subscription-config')
        
        if (response.ok) {
          const config = await response.json()
          setSquareConfig(config)
          console.log('✅ Loaded Square config securely')
        } else {
          const errorData = await response.json()
          setError(`Failed to load payment configuration: ${errorData.error || 'Unknown error'}`)
        }
      } catch (err) {
        console.error('Config fetch error:', err)
        setError('Failed to load payment configuration. Please refresh the page.')
      } finally {
        setConfigLoading(false)
      }
    }
    
    fetchSquareConfig()
  }, [])
  
  // 🔒 SECURE: Initialize Square with fetched config
  useEffect(() => {
    if (!squareLoaded || !window.Square || !squareConfig) return
    
    initializeSquare()
  }, [squareLoaded, squareConfig])
  
async function initializeSquare() {
  if (!squareConfig) {
    setError('Square configuration not loaded')
    return
  }
  
  try {
    console.log('🔄 Initializing Square payments...')
    
    const payments = window.Square.payments(
      squareConfig.application_id,
      squareConfig.location_id
    )
    paymentsRef.current = payments
    
    // ✅ MINIMAL - Only fix iOS zoom, use Square defaults for everything else
    const card = await payments.card({
      style: {
        'input': {
          fontSize: '16px'  // Only this to prevent iOS zoom
        }
      }
    })
    
    await card.attach('#card-container')
    cardRef.current = card
    
    console.log('✅ Square payment form initialized')
    
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
    console.log('🔄 Starting tokenization...')
    
    // Create verification details for tokenization
    const verificationDetails = {
      billingContact: {
        email: customerEmail
      },
     
      intent: 'CHARGE', // We want to charge the card for subscription
      customerInitiated: true,
      sellerKeyedIn: false
    }
    
    // Step 1: Tokenize the card
    const tokenResult = await cardRef.current.tokenize(verificationDetails)
    
    if (tokenResult.status === 'OK') {
      const { token } = tokenResult
      console.log('✅ Card tokenized successfully')
      
      // Step 2: Create subscription with your existing backend
      // Your backend will handle customer creation, card storage, and subscription creation
      const subscriptionResponse = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: orgId,
          plan_type: selectedPlan,
          device_count: deviceCount,
          customer_email: customerEmail,
          source_id: token, // Send the token - your backend will handle the rest
          promo_code: promoCode || null
        })
      })
      
      if (!subscriptionResponse.ok) {
        const errorData = await subscriptionResponse.json()
        throw new Error(errorData.error || 'Failed to create subscription')
      }
      
      const { subscription } = await subscriptionResponse.json()
      console.log('✅ Subscription created:', subscription.id)
      
      // Step 3: Redirect to success page
      router.push(`/subscription/success?org_id=${orgId}&subscription_id=${subscription.id}`)
      
    } else {
      // Handle tokenization errors
      const errors = tokenResult.errors || []
      const errorMessage = errors.map((e: any) => e.message).join(', ')
      setError(errorMessage || 'Failed to process payment information')
      console.error('Tokenization failed:', tokenResult)
    }
    
  } catch (err: any) {
    console.error('Checkout error:', err)
    setError(err.message || 'An error occurred during checkout')
  } finally {
    setIsLoading(false)
  }
}
  
  // Show loading while config is being fetched
  if (configLoading) {
    return (
      <>
        <Head>
          <title>ShulPad Subscription - Loading</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
          
        </Head>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              animation: 'spin 1s linear infinite',
              borderRadius: '50%',
              height: '48px',
              width: '48px',
              borderTop: '2px solid #2563eb',
              borderRight: '2px solid transparent',
              margin: '0 auto'
            }}></div>
            <p style={{ marginTop: '16px', color: '#6b7280' }}>Loading payment configuration...</p>
          </div>
        </div>
        <style jsx>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </>
    )
  }
  
  // Show error if config failed to load
  if (!squareConfig) {
    return (
      <>
        <Head>
          <title>ShulPad Subscription - Configuration Error</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        </Head>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{ maxWidth: '448px', width: '100%', textAlign: 'center' }}>
            <div style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '24px'
            }}>
              <h1 style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: '#7f1d1d',
                marginBottom: '8px'
              }}>Configuration Error</h1>
              <p style={{
                color: '#b91c1c',
                marginBottom: '16px'
              }}>{error || 'Failed to load payment configuration'}</p>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#dc2626',
                  color: 'white',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }
  
return (
  <>
    <Head>
      <title>ShulPad Subscription</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
    </Head>
    
    <Script 
      src="https://web.squarecdn.com/v1/square.js"
      onLoad={() => setSquareLoaded(true)}
      strategy="afterInteractive"
    />
    
    {/* Clean, premium background */}
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0F172A', // Deep navy
      padding: '40px 20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "SF Pro Text", Roboto, sans-serif'
    }}>
      <div style={{ maxWidth: '500px', margin: '0 auto' }}>
        
        {/* Premium header */}
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <div style={{
            width: '80px',
            height: '80px',
            backgroundColor: '#3B82F6',
            borderRadius: '20px',
            margin: '0 auto 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 25px 50px rgba(59, 130, 246, 0.4)'
          }}>
            <span style={{ fontSize: '32px' }}>💎</span>
          </div>
          <h1 style={{ 
            fontSize: '36px', 
            fontWeight: '800', 
            color: 'white',
            marginBottom: '12px',
            letterSpacing: '-1px'
          }}>
            ShulPad Pro
          </h1>
          <p style={{ 
            color: '#94A3B8', 
            fontSize: '18px',
            fontWeight: '400',
            lineHeight: '1.5'
          }}>
            Professional donation platform for your organization
          </p>
        </div>
        
        <form onSubmit={handleSubmit}>
          {/* Plan Selection */}
          <div style={{
            backgroundColor: '#1E293B',
            padding: '32px',
            borderRadius: '24px',
            marginBottom: '24px',
            border: '1px solid #334155'
          }}>
            <h2 style={{ 
              fontSize: '22px', 
              fontWeight: '700', 
              marginBottom: '24px',
              color: 'white'
            }}>
              Choose Your Plan
            </h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Monthly Plan */}
              <div 
                onClick={() => setSelectedPlan('monthly')}
                style={{
                  padding: '24px',
                  border: selectedPlan === 'monthly' ? '2px solid #3B82F6' : '2px solid #374151',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  backgroundColor: selectedPlan === 'monthly' ? '#1E3A8A' : '#374151',
                  transition: 'all 0.2s ease',
                  position: 'relative'
                }}
              >
                {selectedPlan === 'monthly' && (
                  <div style={{
                    position: 'absolute',
                    top: '16px',
                    right: '16px',
                    backgroundColor: '#10B981',
                    color: 'white',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: '700',
                    borderRadius: '20px',
                    textTransform: 'uppercase'
                  }}>
                    Selected
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    border: selectedPlan === 'monthly' ? '6px solid #3B82F6' : '2px solid #6B7280',
                    marginRight: '16px',
                    backgroundColor: selectedPlan === 'monthly' ? '#1E40AF' : 'transparent'
                  }}></div>
                  <div>
                    <div style={{ 
                      fontWeight: '700', 
                      fontSize: '18px',
                      color: 'white',
                      marginBottom: '4px'
                    }}>
                      Monthly Plan
                    </div>
                    <div style={{ 
                      fontSize: '14px', 
                      color: '#94A3B8'
                    }}>
                      Perfect for getting started
                    </div>
                  </div>
                </div>
                <div style={{ 
                  fontSize: '32px', 
                  fontWeight: '800',
                  color: '#3B82F6',
                  marginLeft: '36px'
                }}>
                  $49<span style={{ fontSize: '16px', fontWeight: '500', color: '#94A3B8' }}>/month</span>
                </div>
              </div>
              
              {/* Yearly Plan */}
              <div 
                onClick={() => setSelectedPlan('yearly')}
                style={{
                  padding: '24px',
                  border: selectedPlan === 'yearly' ? '2px solid #10B981' : '2px solid #374151',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  backgroundColor: selectedPlan === 'yearly' ? '#064E3B' : '#374151',
                  transition: 'all 0.2s ease',
                  position: 'relative'
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: '16px',
                  right: '16px',
                  backgroundColor: '#F59E0B',
                  color: 'white',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: '700',
                  borderRadius: '20px',
                  textTransform: 'uppercase'
                }}>
                  Save 17%
                </div>
                {selectedPlan === 'yearly' && (
                  <div style={{
                    position: 'absolute',
                    top: '16px',
                    right: '16px',
                    backgroundColor: '#10B981',
                    color: 'white',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: '700',
                    borderRadius: '20px',
                    textTransform: 'uppercase'
                  }}>
                    Selected
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    border: selectedPlan === 'yearly' ? '6px solid #10B981' : '2px solid #6B7280',
                    marginRight: '16px',
                    backgroundColor: selectedPlan === 'yearly' ? '#059669' : 'transparent'
                  }}></div>
                  <div>
                    <div style={{ 
                      fontWeight: '700', 
                      fontSize: '18px',
                      color: 'white',
                      marginBottom: '4px'
                    }}>
                      Yearly Plan
                    </div>
                    <div style={{ 
                      fontSize: '14px', 
                      color: '#94A3B8'
                    }}>
                      Best value for growing organizations
                    </div>
                  </div>
                </div>
                <div style={{ 
                  fontSize: '32px', 
                  fontWeight: '800',
                  color: '#10B981',
                  marginLeft: '36px'
                }}>
                  $490<span style={{ fontSize: '16px', fontWeight: '500', color: '#94A3B8' }}>/year</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Device Count & Email Row */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
            {/* Device Count */}
            <div style={{
              backgroundColor: '#1E293B',
              padding: '24px',
              borderRadius: '20px',
              border: '1px solid #334155',
              flex: '1'
            }}>
              <h3 style={{ 
                fontSize: '16px', 
                fontWeight: '700', 
                marginBottom: '20px',
                color: 'white',
                textAlign: 'center'
              }}>
                Devices
              </h3>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                gap: '16px'
              }}>
                <button
                  type="button"
                  onClick={() => setDeviceCount(Math.max(1, deviceCount - 1))}
                  style={{
                    width: '44px',
                    height: '44px',
                    border: '2px solid #475569',
                    borderRadius: '12px',
                    backgroundColor: '#374151',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px',
                    fontWeight: '700',
                    color: 'white',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.borderColor = '#3B82F6'
                    e.currentTarget.style.backgroundColor = '#1E40AF'
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.borderColor = '#475569'
                    e.currentTarget.style.backgroundColor = '#374151'
                  }}
                >
                  −
                </button>
                <div style={{
                  fontSize: '24px',
                  fontWeight: '800',
                  color: 'white',
                  minWidth: '40px',
                  textAlign: 'center'
                }}>
                  {deviceCount}
                </div>
                <button
                  type="button"
                  onClick={() => setDeviceCount(deviceCount + 1)}
                  style={{
                    width: '44px',
                    height: '44px',
                    border: '2px solid #475569',
                    borderRadius: '12px',
                    backgroundColor: '#374151',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px',
                    fontWeight: '700',
                    color: 'white',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.borderColor = '#3B82F6'
                    e.currentTarget.style.backgroundColor = '#1E40AF'
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.borderColor = '#475569'
                    e.currentTarget.style.backgroundColor = '#374151'
                  }}
                >
                  +
                </button>
              </div>
              {deviceCount > 1 && (
                <p style={{ 
                  marginTop: '12px', 
                  fontSize: '12px', 
                  color: '#94A3B8',
                  textAlign: 'center',
                  fontWeight: '500'
                }}>
                  +${PLAN_PRICING[selectedPlan].extra} each
                </p>
              )}
            </div>
            
            {/* Email */}
            <div style={{
              backgroundColor: '#1E293B',
              padding: '24px',
              borderRadius: '20px',
              border: '1px solid #334155',
              flex: '2'
            }}>
              <h3 style={{ 
                fontSize: '16px', 
                fontWeight: '700', 
                marginBottom: '16px',
                color: 'white'
              }}>
                Email Address
              </h3>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="your@email.com"
                required
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  border: '2px solid #475569',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontWeight: '500',
                  boxSizing: 'border-box',
                  backgroundColor: '#374151',
                  color: 'white',
                  transition: 'all 0.2s ease',
                  outline: 'none'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#3B82F6'
                  e.currentTarget.style.backgroundColor = '#1E40AF'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#475569'
                  e.currentTarget.style.backgroundColor = '#374151'
                }}
              />
            </div>
          </div>
          
          {/* Payment Details */}
          <div style={{
            backgroundColor: '#1E293B',
            padding: '32px',
            borderRadius: '20px',
            marginBottom: '24px',
            border: '1px solid #334155'
          }}>
            <h2 style={{ 
              fontSize: '20px', 
              fontWeight: '700', 
              marginBottom: '20px',
              color: 'white'
            }}>
              🔒 Secure Payment
            </h2>
            <div 
              id="card-container" 
              ref={cardContainerRef} 
              style={{
                minHeight: '120px',
                border: '2px solid #475569',
                borderRadius: '16px',
                padding: '24px',
                backgroundColor: '#374151',
                transition: 'all 0.2s ease'
              }}
            >
              {!squareLoaded && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '72px',
                  color: '#94A3B8',
                  flexDirection: 'column',
                  gap: '16px'
                }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    border: '4px solid #475569',
                    borderTop: '4px solid #3B82F6',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }}></div>
                  <span style={{ fontSize: '16px', fontWeight: '600' }}>
                    Loading secure payment form...
                  </span>
                </div>
              )}
            </div>
          </div>
          
          {/* Promo Code */}
          <div style={{
            backgroundColor: '#1E293B',
            padding: '24px',
            borderRadius: '20px',
            marginBottom: '24px',
            border: '1px solid #334155'
          }}>
            <h3 style={{ 
              fontSize: '16px', 
              fontWeight: '700', 
              marginBottom: '16px',
              color: 'white'
            }}>
              🎁 Promo Code <span style={{ color: '#94A3B8', fontWeight: '400' }}>(Optional)</span>
            </h3>
            <input
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              placeholder="Enter promo code"
              style={{
                width: '100%',
                padding: '14px 16px',
                border: '2px solid #475569',
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: '500',
                boxSizing: 'border-box',
                backgroundColor: '#374151',
                color: 'white',
                transition: 'all 0.2s ease',
                outline: 'none'
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#3B82F6'
                e.currentTarget.style.backgroundColor = '#1E40AF'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#475569'
                e.currentTarget.style.backgroundColor = '#374151'
              }}
            />
          </div>
          
          {/* Order Summary */}
          <div style={{
            backgroundColor: '#065F46',
            padding: '32px',
            borderRadius: '20px',
            marginBottom: '32px',
            border: '2px solid #10B981'
          }}>
            <h2 style={{ 
              fontSize: '22px', 
              fontWeight: '800', 
              marginBottom: '24px',
              color: 'white',
              textAlign: 'center'
            }}>
              💰 Order Summary
            </h2>
            <div style={{ fontSize: '16px', fontWeight: '600' }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                marginBottom: '12px',
                color: '#D1FAE5'
              }}>
                <span>Base plan ({selectedPlan})</span>
                <span>${basePrice}</span>
              </div>
              {deviceCount > 1 && (
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  marginBottom: '12px',
                  color: '#D1FAE5'
                }}>
                  <span>{deviceCount - 1} additional device{deviceCount > 2 ? 's' : ''}</span>
                  <span>${extraDevicePrice}</span>
                </div>
              )}
              <div style={{
                borderTop: '2px solid #10B981',
                paddingTop: '20px',
                marginTop: '20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '24px', fontWeight: '800', color: 'white' }}>
                  Total
                </span>
                <span style={{ 
                  fontSize: '36px', 
                  fontWeight: '900',
                  color: '#10B981'
                }}>
                  ${totalPrice}
                  <span style={{ 
                    fontSize: '18px', 
                    fontWeight: '600',
                    color: '#D1FAE5',
                    marginLeft: '8px'
                  }}>
                    /{selectedPlan === 'monthly' ? 'mo' : 'yr'}
                  </span>
                </span>
              </div>
            </div>
          </div>
          
          {/* Error Message */}
          {error && (
            <div style={{
              backgroundColor: '#7F1D1D',
              border: '2px solid #DC2626',
              color: '#FCA5A5',
              padding: '20px 24px',
              borderRadius: '16px',
              marginBottom: '24px',
              fontSize: '16px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <span style={{ fontSize: '20px' }}>⚠️</span>
              {error}
            </div>
          )}
          
          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || !squareLoaded || !squareConfig}
            style={{
              width: '100%',
              padding: '20px 32px',
              borderRadius: '16px',
              fontWeight: '800',
              fontSize: '18px',
              border: 'none',
              cursor: isLoading || !squareLoaded || !squareConfig ? 'not-allowed' : 'pointer',
              backgroundColor: isLoading || !squareLoaded || !squareConfig ? '#6B7280' : '#3B82F6',
              color: 'white',
              marginBottom: '32px',
              boxShadow: isLoading || !squareLoaded || !squareConfig 
                ? 'none' 
                : '0 20px 40px rgba(59, 130, 246, 0.4)',
              transition: 'all 0.3s ease',
              transform: 'translateY(0)',
              letterSpacing: '0.5px'
            }}
            onMouseOver={(e) => {
              if (!isLoading && squareLoaded && squareConfig) {
                e.currentTarget.style.transform = 'translateY(-4px)'
                e.currentTarget.style.backgroundColor = '#1E40AF'
                e.currentTarget.style.boxShadow = '0 25px 50px rgba(59, 130, 246, 0.6)'
              }
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.backgroundColor = '#3B82F6'
              e.currentTarget.style.boxShadow = '0 20px 40px rgba(59, 130, 246, 0.4)'
            }}
          >
            {isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                <div style={{
                  width: '20px',
                  height: '20px',
                  border: '3px solid rgba(255, 255, 255, 0.3)',
                  borderTop: '3px solid white',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }}></div>
                Processing Payment...
              </div>
            ) : (
              `🚀 Subscribe for $${totalPrice}/${selectedPlan === 'monthly' ? 'month' : 'year'}`
            )}
          </button>
          
          {/* Return to App */}
          <div style={{ textAlign: 'center' }}>
            <a 
              href={`shulpad://subscription/cancelled?org_id=${orgId}`}
              style={{
                color: '#94A3B8',
                fontSize: '16px',
                textDecoration: 'none',
                fontWeight: '600',
                padding: '12px 20px',
                borderRadius: '12px',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.color = 'white'
                e.currentTarget.style.backgroundColor = '#374151'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.color = '#94A3B8'
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              ← Return to ShulPad
            </a>
          </div>
        </form>
      </div>
    </div>
    
    <style jsx>{`
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      input::placeholder {
        color: #94A3B8;
      }
    `}</style>
  </>
)
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            animation: 'spin 1s linear infinite',
            borderRadius: '50%',
            height: '48px',
            width: '48px',
            borderTop: '2px solid #2563eb',
            borderRight: '2px solid transparent',
            margin: '0 auto'
          }}></div>
          <p style={{ marginTop: '16px', color: '#6b7280' }}>Loading checkout...</p>
        </div>
      </div>
    }>
      <CheckoutPageContent />
    </Suspense>
  )
}