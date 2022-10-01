import Game from './Game'

const REFRESH_RATE: number = 50
const TICK_BETWEEN_SAVE: number = 20

const startGameLoop = (game: Game, onUpdate: () => void, saveGame: () => void): (() => void) => {
    let stop = false
    let tickCount = 0
    void new Promise<void>((resolve) => {
        const gameloop = (): void => {
            const startTime = Date.now()
            game.update(REFRESH_RATE)
            onUpdate()
            tickCount++
            if (tickCount >= TICK_BETWEEN_SAVE) {
                tickCount = 0
                saveGame()
            }
            let tickTime = Date.now() - startTime
            while (tickTime > REFRESH_RATE) {
                tickTime -= REFRESH_RATE
                console.log('SKIPPING TICK')
            }
            if (!stop) {
                setTimeout(gameloop, REFRESH_RATE - tickTime)
            } else {
                resolve()
            }
        }
        gameloop()
    })
    const stopLoop = (): void => {
        stop = true
    }
    return stopLoop
}
export default startGameLoop
