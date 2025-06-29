// src/app/subscription/manage/page.tsx - WITH GUARANTEED INLINE STYLES
'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Head from 'next/head'

interface SubscriptionDetails {
  id: string
  status: string
  plan_type: string
  device_count: number
  total_price: number
  next_billing_date: string
  card_last_four: string
}

function ManagePageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const merchantId = searchParams.get('merchant_id') || 'default'
  
  const [subscription, setSubscription] = useState<SubscriptionDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    fetchSubscriptionDetails()
  }, [merchantId])
  
  async function fetchSubscriptionDetails() {
    try {
      const response = await fetch(`/api/subscriptions/status?merchant_id=${merchantId}`)
      if (!response.ok) throw new Error('Failed to fetch subscription')
      
      const data = await response.json()
      if (data.subscription) {
        setSubscription(data.subscription)
      } else {
        setError('No active subscription found')
      }
    } catch (err) {
      setError('Failed to load subscription details')
    } finally {
      setIsLoading(false)
    }
  }
  
  async function handleCancelSubscription() {
    if (!confirm('Are you sure you want to cancel your subscription?'))
      return
      
    try {
      const response = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_id: merchantId })
      })
      
      if (!response.ok) throw new Error('Failed to cancel subscription')
      
      alert('Subscription cancelled successfully')
      router.push(`shulpad://subscription/cancelled?merchant_id=${merchantId}`)
    } catch (err) {
      alert('Failed to cancel subscription')
    }
  }
  
  if (isLoading) {
    return (
      <>
        <Head>
          <title>ShulPad Subscription - Loading</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        </Head>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '48px',
              height: '48px',
              border: '4px solid #e5e7eb',
              borderTop: '4px solid #2563eb',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px auto'
            }}></div>
            <p style={{ color: '#6b7280', fontSize: '16px' }}>Loading subscription details...</p>
          </div>
        </div>
        <style dangerouslySetInnerHTML={{
          __html: `
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `
        }} />
      </>
    )
  }
  
  if (error || !subscription) {
    return (
      <>
        <Head>
          <title>ShulPad Subscription - No Active Subscription</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        </Head>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}>
          <div style={{ maxWidth: '448px', width: '100%', textAlign: 'center' }}>
            <h1 style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: '#111827',
              marginBottom: '16px'
            }}>
              No Active Subscription
            </h1>
            <p style={{
              color: '#6b7280',
              marginBottom: '32px',
              fontSize: '16px',
              lineHeight: '1.5'
            }}>
              {error || 'You don\'t have an active subscription.'}
            </p>
            <a
              href={`/subscription/checkout?org_id=${merchantId}`}
              style={{
                display: 'inline-block',
                padding: '12px 24px',
                backgroundColor: '#2563eb',
                color: 'white',
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: '500',
                fontSize: '16px',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1d4ed8'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
            >
              Subscribe Now
            </a>
          </div>
        </div>
      </>
    )
  }
  
  return (
    <>
      <Head>
        <title>ShulPad Subscription - Manage</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta name="format-detection" content="telephone=no" />
      </Head>
      
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        padding: '48px 16px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{ maxWidth: '448px', margin: '0 auto' }}>
          <h1 style={{
            fontSize: '30px',
            fontWeight: 'bold',
            color: '#111827',
            marginBottom: '32px',
            textAlign: 'center'
          }}>
            Manage Subscription
          </h1>
          
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
            overflow: 'hidden'
          }}>
            {/* Subscription Status */}
            <div style={{ padding: '24px' }}>
              <h2 style={{
                fontSize: '18px',
                fontWeight: '600',
                marginBottom: '16px',
                color: '#111827'
              }}>
                Subscription Details
              </h2>
              
              <div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #f3f4f6'
                }}>
                  <span style={{ color: '#6b7280' }}>Status</span>
                  <span style={{
                    padding: '4px 8px',
                    borderRadius: '9999px',
                    fontSize: '12px',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    backgroundColor: subscription.status === 'active' ? '#dcfce7' : '#f3f4f6',
                    color: subscription.status === 'active' ? '#166534' : '#374151'
                  }}>
                    {subscription.status}
                  </span>
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #f3f4f6'
                }}>
                  <span style={{ color: '#6b7280' }}>Plan</span>
                  <span style={{ fontWeight: '500', textTransform: 'capitalize' }}>
                    {subscription.plan_type}
                  </span>
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #f3f4f6'
                }}>
                  <span style={{ color: '#6b7280' }}>Devices</span>
                  <span style={{ fontWeight: '500' }}>{subscription.device_count}</span>
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #f3f4f6'
                }}>
                  <span style={{ color: '#6b7280' }}>Price</span>
                  <span style={{ fontWeight: '500' }}>
                    ${subscription.total_price}/{subscription.plan_type === 'monthly' ? 'month' : 'year'}
                  </span>
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0'
                }}>
                  <span style={{ color: '#6b7280' }}>Next Billing</span>
                  <span style={{ fontWeight: '500' }}>
                    {new Date(subscription.next_billing_date).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Payment Method */}
            <div style={{
              padding: '24px',
              borderTop: '1px solid #e5e7eb'
            }}>
              <h2 style={{
                fontSize: '18px',
                fontWeight: '600',
                marginBottom: '16px',
                color: '#111827'
              }}>
                Payment Method
              </h2>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{
                    width: '48px',
                    height: '32px',
                    backgroundColor: '#f3f4f6',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    marginRight: '12px'
                  }}>
                    ****
                  </div>
                  <span style={{ color: '#6b7280' }}>
                    Card ending in {subscription.card_last_four}
                  </span>
                </div>
                <button style={{
                  color: '#2563eb',
                  background: 'none',
                  border: 'none',
                  fontSize: '14px',
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}>
                  Update
                </button>
              </div>
            </div>
            
            {/* Actions */}
            <div style={{
              padding: '24px',
              borderTop: '1px solid #e5e7eb'
            }}>
              <button
                onClick={() => router.push(`/subscription/checkout?org_id=${merchantId}&plan=${subscription.plan_type}&devices=${subscription.device_count}`)}
                style={{
                  width: '100%',
                  marginBottom: '12px',
                  padding: '12px 16px',
                  backgroundColor: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1d4ed8'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
              >
                Change Plan
              </button>
              <button
                onClick={handleCancelSubscription}
                style={{
                  width: '100%',
                  padding: '8px 16px',
                  backgroundColor: 'white',
                  color: '#dc2626',
                  border: '1px solid #dc2626',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'white'}
              >
                Cancel Subscription
              </button>
            </div>
          </div>
          
          {/* Return to App */}
          <div style={{
            marginTop: '32px',
            textAlign: 'center'
          }}>
            <a
              href={`shulpad://subscription/manage?org_id=${merchantId}`}
              style={{
                color: '#2563eb',
                textDecoration: 'underline'
              }}
            >
              Return to ShulPad
            </a>
          </div>
        </div>
      </div>
    </>
  )
}

export default function ManagePage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '48px',
            height: '48px',
            border: '4px solid #e5e7eb',
            borderTop: '4px solid #2563eb',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px auto'
          }}></div>
          <p style={{ color: '#6b7280', fontSize: '16px' }}>Loading...</p>
        </div>
        <style dangerouslySetInnerHTML={{
          __html: `
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `
        }} />
      </div>
    }>
      <ManagePageContent />
    </Suspense>
  )
}