import React, { useEffect, useReducer } from 'react'
import './css/App.css'
import Game from './Game/Game'
import startGameLoop from './Game/GameLoop'
import GameSave from './Game/Save/GameSave'
import GameView from './Views/GameView'

const STORAGE_NAME = 'game'

const loadGame = (): Game => {
    const stringSave = localStorage.getItem(STORAGE_NAME)
    if (stringSave !== null && stringSave !== '') {
        try {
            return new GameSave(undefined, JSON.parse(stringSave)).getObj()
        } catch (error) {
            console.error('Impossible de charger la sauvegarde, une nouvelle partie est créée.', error)
        }
    }
    return new Game()
}

const GAME = loadGame()

if (GAME.factory.name === 'Main') {
    GAME.factory.name = 'Usine principale'
}

const saveGame = (): void => {
    localStorage.setItem(STORAGE_NAME, JSON.stringify(new GameSave(GAME)))
}

const clearGame = (): void => {
    if (window.confirm('Réinitialiser définitivement la partie et effacer la sauvegarde ?')) {
        localStorage.removeItem(STORAGE_NAME)
        window.location.reload()
    }
}

const App = (): JSX.Element => {
    const forceUpdate = useReducer(() => ({}), {})[1] as () => void

    useEffect(() => {
        const stopLoop = startGameLoop(GAME, forceUpdate, saveGame)
        return stopLoop
    }, [forceUpdate])

    return (
        <GameView
            game={GAME}
            onGrantResources={() => GAME.cheatMoney()}
            onReset={clearGame}
        />
    )
}

export default App
