/**
 * Secure password hashing (bcrypt).
 * Never store plaintext passwords.
 */
import bcrypt from 'bcryptjs'

const ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12)

export async function hashPassword(plain) {
  const password = String(plain || '')
  if (password.length < 8) {
    const error = new Error('Password must be at least 8 characters.')
    error.status = 400
    throw error
  }
  if (password.length > 200) {
    const error = new Error('Password is too long.')
    error.status = 400
    throw error
  }
  return bcrypt.hash(password, ROUNDS)
}

export async function verifyPassword(plain, passwordHash) {
  if (!passwordHash || !plain) return false
  return bcrypt.compare(String(plain), String(passwordHash))
}
