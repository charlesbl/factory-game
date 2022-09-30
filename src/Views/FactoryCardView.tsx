import React from 'react'
import { notImplemented } from '..'
import '../css/FactoryCardView.css'
import Factory from '../Game/Factory'
import IngredientsView from './IngredientsView'

interface IFactoryProps {
    factory: Factory
    onClickEnter: () => void
    onDeleteFactory: () => void
}

const FactoryCardView = (props: IFactoryProps): JSX.Element => {
    return (
        <div className="factory">
            <div className="factory-header">
                <div className="name">Factory</div>
                {/* TODO */}<button onClick={() => notImplemented()} className="btn btn-primary btn-modify"><i className="fas fa-edit fa-xs"></i></button>
            </div>

            <div className="factory-wrapper">
                <IngredientsView ingredients={props.factory.inputs} />
                <div>
                    <div className="arrow"><i className="fas fa-arrow-right fa-10px"></i></div>
                    <div className="fbtn-wrapper">
                        <button className="btn btn-primary" onClick={() => props.onClickEnter()}>Enter</button>
                        <button className="btn btn-danger btn-destroy" onClick={() => props.onDeleteFactory()}><i className="fas fa-trash fa-xs"></i></button>
                    </div>
                </div>
                <IngredientsView ingredients={props.factory.outputs} />
            </div>
        </div>
    )
}

export default FactoryCardView
