'use client'
import { useEffect, useState } from 'react'
import { createClient } from './lib/supabase'
import Kalkulator from './kalkulator'

export default function Home() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    })
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  if (loading) return <div style={{ background:'#0f1117', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', color:'#e8eaf0', fontFamily:'sans-serif' }}>Laster...</div>

  if (!user) return (
    <div style={{ background:'#0f1117', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'sans-serif' }}>
      <div style={{ textAlign:'center' }}>
        <h1 style={{ color:'#e8eaf0', fontSize:24, marginBottom:8 }}>Lønnskalkulator</h1>
        <p style={{ color:'#8891aa', marginBottom:24 }}>Logg inn for å komme i gang</p>
        <button onClick={signIn} style={{ padding:'12px 28px', background:'#5b8af5', border:'none', borderRadius:8, color:'white', fontSize:15, fontWeight:500, cursor:'pointer' }}>
          Logg inn med Google
        </button>
      </div>
    </div>
  )

  return <Kalkulator user={user} onSignOut={signOut} />
}
